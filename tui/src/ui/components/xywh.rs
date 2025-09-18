//! SPDX-License-Identifier: MIT

#[cfg(any(
    feature = "cover-viuer-iterm",
    feature = "cover-viuer-kitty",
    feature = "cover-viuer-sixel"
))]
use std::io::Write;

#[cfg(any(
    feature = "cover-viuer-iterm",
    feature = "cover-viuer-kitty",
    feature = "cover-viuer-sixel"
))]
use anyhow::Context;
use anyhow::Result;
use bytes::Buf;
use image::DynamicImage;
use lofty::picture::Picture;
use termusiclib::track::MediaTypes;
use tokio::runtime::Handle;

use crate::ui::ids::{Id, IdConfigEditor, IdTagEditor};
use crate::ui::model::{Model, TxToMain, ViuerSupported};
use crate::ui::msg::{CoverDLResult, ImageWrapper, Msg, XYWHMsg};

impl Model {
    pub fn xywh_move_left(&mut self) {
        self.xywh.move_left();
        self.update_photo().ok();
    }

    pub fn xywh_move_right(&mut self) {
        self.xywh.move_right();
        self.update_photo().ok();
    }

    pub fn xywh_move_up(&mut self) {
        self.xywh.move_up();
        self.update_photo().ok();
    }

    pub fn xywh_move_down(&mut self) {
        self.xywh.move_down();
        self.update_photo().ok();
    }
    pub fn xywh_zoom_in(&mut self) {
        self.xywh.zoom_in();
        self.update_photo().ok();
    }
    pub fn xywh_zoom_out(&mut self) {
        self.xywh.zoom_out();
        self.update_photo().ok();
    }
    pub fn xywh_toggle_hide(&mut self) {
        self.clear_photo().ok();
        let mut config_tui = self.config_tui.write();

        // dont save value if cli has overwritten it, but still allow runtime changing
        if let Some(current) = config_tui.coverart_hidden_overwrite {
            config_tui.coverart_hidden_overwrite = Some(!current);
            info!("Not saving coverart.hidden as it is overwritten by cli!");
        } else {
            config_tui.settings.coverart.hidden = !config_tui.settings.coverart.hidden;
        }

        drop(config_tui);
        self.update_photo().ok();
    }
    fn should_not_show_photo(&self) -> bool {
        if self.app.mounted(&Id::HelpPopup) {
            return true;
        }
        if self.app.mounted(&Id::PodcastSearchTablePopup) {
            return true;
        }

        if self.app.mounted(&Id::TagEditor(IdTagEditor::InputTitle)) {
            return true;
        }


        if self.app.mounted(&Id::GeneralSearchInput) {
            return true;
        }

        if self.playback.is_stopped() {
            return true;
        }

        if self.app.mounted(&Id::ConfigEditor(IdConfigEditor::Header)) {
            return true;
        }

        false
    }

    /// Get and show a image for the current playing media
    ///
    /// Requires that the current thread has a entered runtime
    #[allow(clippy::cast_possible_truncation)]
    pub fn update_photo(&mut self) -> Result<()> {
        if self.config_tui.read().get_coverart_hidden() {
            return Ok(());
        }
        self.clear_photo()?;

        if self.should_not_show_photo() {
            return Ok(());
        }
        let Some(track) = self.playback.current_track() else {
            return Ok(());
        };

        match track.inner() {
            MediaTypes::Track(track_data) => {
                let res = match track.get_picture() {
                    Ok(v) => v,
                    Err(err) => {
                        error!(
                            "Getting the track for \"{}\" failed! Error: {}",
                            track_data.path().display(),
                            err
                        );
                        return Ok(());
                    }
                };
                if let Some(picture) = res {
                    if let Ok(image) = image::load_from_memory(picture.data()) {
                        self.show_image(&image)?;
                        return Ok(());
                    }
                }
            }
            MediaTypes::Radio(_radio_track_data) => (),
            MediaTypes::Podcast(podcast_track_data) => {
                let url = {
                    if let Some(episode_photo_url) = podcast_track_data.image_url() {
                        episode_photo_url.to_string()
                    } else if let Some(pod_photo_url) =
                        self.podcast_get_album_photo_by_url(podcast_track_data.url())
                    {
                        pod_photo_url
                    } else {
                        return Ok(());
                    }
                };

                if url.is_empty() {
                    return Ok(());
                }
                let tx = self.tx_to_main.clone();

                Handle::current().spawn(Self::fetch_podcast_image(tx, url));
            }
        }

        Ok(())
    }

    /// Fetch the given url as a image and send events when done or error.
    async fn fetch_podcast_image(tx: TxToMain, url: String) {
        match reqwest::get(&url).await {
            Ok(result) => {
                if result.status() != reqwest::StatusCode::OK {
                    tx.send(Msg::Xywh(XYWHMsg::CoverDLResult(
                        CoverDLResult::FetchPhotoErr(format!(
                            "Error non-OK Status code: {}",
                            result.status()
                        )),
                    )))
                    .ok();
                    return;
                }

                let mut reader = {
                    let bytes = match result.bytes().await {
                        Ok(v) => v,
                        Err(err) => {
                            tx.send(Msg::Xywh(XYWHMsg::CoverDLResult(
                                CoverDLResult::FetchPhotoErr(format!(
                                    "Error in reqest::Response::bytes: {err}"
                                )),
                            )))
                            .ok();
                            return;
                        }
                    };

                    bytes.reader()
                };

                let picture = match Picture::from_reader(&mut reader) {
                    Ok(v) => v,
                    Err(e) => {
                        tx.send(Msg::Xywh(XYWHMsg::CoverDLResult(
                            CoverDLResult::FetchPhotoErr(format!(
                                "Error in picture from_reader: {e}"
                            )),
                        )))
                        .ok();
                        return;
                    }
                };

                match image::load_from_memory(picture.data()) {
                    Ok(image) => {
                        let image_wrapper = ImageWrapper { data: image };
                        tx.send(Msg::Xywh(XYWHMsg::CoverDLResult(
                            CoverDLResult::FetchPhotoSuccess(image_wrapper),
                        )))
                        .ok()
                    }
                    Err(e) => tx
                        .send(Msg::Xywh(XYWHMsg::CoverDLResult(
                            CoverDLResult::FetchPhotoErr(format!("Error in load_from_memory: {e}")),
                        )))
                        .ok(),
                }
            }
            Err(e) => tx
                .send(Msg::Xywh(XYWHMsg::CoverDLResult(
                    CoverDLResult::FetchPhotoErr(format!("Error in ureq get: {e}")),
                )))
                .ok(),
        };
    }

    #[allow(clippy::cast_possible_truncation, clippy::unnecessary_wraps)]
    pub fn show_image(&mut self, img: &DynamicImage) -> Result<()> {
        #[allow(unused_variables)]
        let xywh = self.xywh.update_size(img)?;

        // error!("{:?}", self.viuer_supported);
        match self.viuer_supported {
            ViuerSupported::NotSupported => {
                #[cfg(all(feature = "cover-ueberzug", not(target_os = "windows")))]
                if let Some(instance) = self.ueberzug_instance.as_mut() {
                    let mut cache_file = dirs::cache_dir().unwrap_or_else(std::env::temp_dir);
                    cache_file.push("termusic");
                    if !cache_file.exists() {
                        std::fs::create_dir_all(&cache_file)?;
                    }
                    cache_file.push("termusic_cover.jpg");
                    img.save(&cache_file)?;
                    if !cache_file.exists() {
                        anyhow::bail!("cover file is not saved correctly");
                    }
                    if let Some(file) = cache_file.as_path().to_str() {
                        instance.draw_cover_ueberzug(file, &xywh, false)?;
                    }
                }
            }
            #[cfg(any(
                feature = "cover-viuer-iterm",
                feature = "cover-viuer-kitty",
                feature = "cover-viuer-sixel"
            ))]
            _ => {
                let config = viuer::Config {
                    transparent: true,
                    absolute_offset: true,
                    x: xywh.x as u16,
                    y: xywh.y as i16,
                    width: Some(xywh.width),
                    height: None,
                    // Force the specific protocol we probed for earlier
                    #[cfg(feature = "cover-viuer-iterm")]
                    use_iterm: self.viuer_supported == ViuerSupported::ITerm,
                    #[cfg(feature = "cover-viuer-kitty")]
                    use_kitty: self.viuer_supported == ViuerSupported::Kitty,
                    #[cfg(feature = "cover-viuer-sixel")]
                    use_sixel: self.viuer_supported == ViuerSupported::Sixel,
                    ..viuer::Config::default()
                };
                viuer::print(img, &config).context("viuer::print")?;
            }
        }

        Ok(())
    }

    #[allow(clippy::unnecessary_wraps)]
    fn clear_photo(&mut self) -> Result<()> {
        match self.viuer_supported {
            #[cfg(feature = "cover-viuer-kitty")]
            ViuerSupported::Kitty => {
                self.clear_image_viuer_kitty()
                    .context("clear_photo kitty")?;
                Self::remove_temp_files()?;
            }
            #[cfg(feature = "cover-viuer-iterm")]
            ViuerSupported::ITerm => {
                self.clear_image_viuer_kitty()
                    .context("clear_photo iterm")?;
                Self::remove_temp_files()?;
            }
            #[cfg(feature = "cover-viuer-sixel")]
            ViuerSupported::Sixel => {
                self.clear_image_viuer_kitty()
                    .context("clear_photo sixel")?;
                // sixel does not use temp-files, so no cleaning necessary
            }
            ViuerSupported::NotSupported => {
                #[cfg(all(feature = "cover-ueberzug", not(target_os = "windows")))]
                if let Some(instance) = self.ueberzug_instance.as_mut() {
                    instance.clear_cover_ueberzug()?;
                }
            }
        }
        Ok(())
    }

    #[cfg(any(
        feature = "cover-viuer-iterm",
        feature = "cover-viuer-kitty",
        feature = "cover-viuer-sixel"
    ))]
    fn clear_image_viuer_kitty(&mut self) -> Result<()> {
        write!(self.terminal.raw_mut().backend_mut(), "\x1b_Ga=d\x1b\\")?;
        self.terminal.raw_mut().backend_mut().flush()?;
        Ok(())
    }

    #[cfg(any(feature = "cover-viuer-iterm", feature = "cover-viuer-kitty"))]
    fn remove_temp_files() -> Result<()> {
        // Clean up temp files created by `viuer`'s kitty printer to avoid
        // possible freeze because of too many temp files in the temp folder.
        // Context: https://github.com/aome510/spotify-player/issues/148
        let tmp_dir = std::env::temp_dir();
        for path in (std::fs::read_dir(tmp_dir)?).flatten() {
            let path = path.path();
            if path.display().to_string().contains(".tmp.viuer") {
                std::fs::remove_file(path)?;
            }
        }

        Ok(())
    }
}
