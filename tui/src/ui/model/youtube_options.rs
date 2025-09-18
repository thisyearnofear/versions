#[cfg(feature = "youtube")]
use std::path::{Path, PathBuf};
#[cfg(feature = "youtube")]
use std::sync::{Arc, LazyLock};
#[cfg(feature = "youtube")]
use std::thread;
#[cfg(feature = "youtube")]
use std::time::Duration;

#[cfg(feature = "youtube")]
use anyhow::{Context, Result, anyhow, bail};
#[cfg(feature = "youtube")]
use id3::TagLike;
#[cfg(feature = "youtube")]
use id3::Version::Id3v24;
#[cfg(feature = "youtube")]
use regex::Regex;
#[cfg(feature = "youtube")]
use shell_words;
#[cfg(feature = "youtube")]
use termusiclib::invidious::{Instance, YoutubeVideo};
#[cfg(feature = "youtube")]
use termusiclib::track::DurationFmtShort;
#[cfg(feature = "youtube")]
use termusiclib::utils::get_parent_folder;
#[cfg(feature = "youtube")]
use tokio::runtime::Handle;
#[cfg(feature = "youtube")]
use tuirealm::props::{Alignment, AttrValue, Attribute, TableBuilder, TextSpan};
#[cfg(feature = "youtube")]
use tuirealm::{State, StateValue};
#[cfg(feature = "youtube")]
use ytd_rs::{Arg, YoutubeDL};

#[cfg(feature = "youtube")]
use super::Model;
#[cfg(feature = "youtube")]
use crate::ui::ids::Id;
#[cfg(feature = "youtube")]
use crate::ui::msg::{Msg, YSMsg};

#[cfg(feature = "youtube")]
#[expect(dead_code)]
static RE_FILENAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[ffmpeg\] Destination: (?P<name>.*)\.mp3").unwrap());

#[cfg(feature = "youtube")]
static RE_FILENAME_YTDLP: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[ExtractAudio\] Destination: (?P<name>.*)\.mp3").unwrap());

#[cfg(feature = "youtube")]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct YoutubeOptions {
    pub items: Vec<YoutubeVideo>,
    pub page: u32,
    pub invidious_instance: Instance,
}

#[cfg(feature = "youtube")]
impl Default for YoutubeOptions {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            page: 1,
            invidious_instance: Instance::default(),
        }
    }
}

#[cfg(feature = "youtube")]
impl YoutubeOptions {
    pub fn get_by_index(&self, index: usize) -> Result<&YoutubeVideo> {
        if let Some(item) = self.items.get(index) {
            return Ok(item);
        }
        Err(anyhow!("index not found"))
    }

    pub async fn prev_page(&mut self) -> Result<()> {
        if self.page > 1 {
            self.page -= 1;
            self.items = self.invidious_instance.get_search_query(self.page).await?;
        }
        Ok(())
    }

    pub async fn next_page(&mut self) -> Result<()> {
        self.page += 1;
        self.items = self.invidious_instance.get_search_query(self.page).await?;
        Ok(())
    }

    #[must_use]
    pub const fn page(&self) -> u32 {
        self.page
    }
}

#[cfg(feature = "youtube")]
impl Model {
    pub fn youtube_options_download(&mut self, index: usize) -> Result<()> {
        // download from search result here
        if let Ok(item) = self.youtube_options.get_by_index(index) {
            let url = format!("https://www.youtube.com/watch?v={}", item.video_id);
            if let Err(e) = self.youtube_dl(url.as_ref()) {
                bail!("Download error: {e}");
            }
        }
        Ok(())
    }

    /// This function requires to be run in a tokio Runtime context
    pub fn youtube_options_search(&mut self, keyword: String) {
        let tx = self.tx_to_main.clone();
        tokio::spawn(async move {
            match Instance::new(&keyword).await {
                Ok((instance, result)) => {
                    let youtube_options = YoutubeOptions {
                        items: result,
                        page: 1,
                        invidious_instance: instance,
                    };
                    tx.send(Msg::YoutubeSearch(YSMsg::YoutubeSearchSuccess(
                        youtube_options,
                    )))
                    .ok();
                }
                Err(e) => {
                    tx.send(Msg::YoutubeSearch(YSMsg::YoutubeSearchFail(e.to_string())))
                        .ok();
                }
            }
        });
    }

    /// This function requires to be run in a tokio Runtime context
    pub fn youtube_options_prev_page(&mut self) {
        // this needs to be wrapped as this is not running another thread but some main-runtime thread and so needs to inform the runtime to hand-off other tasks
        // though i am not fully sure if that is 100% the case, this avoid the panic though
        tokio::task::block_in_place(move || {
            Handle::current().block_on(async {
                match self.youtube_options.prev_page().await {
                    Ok(()) => self.sync_youtube_options(),
                    Err(e) => self.mount_error_popup(e.context("youtube-dl search")),
                }
            });
        });
    }

    /// This function requires to be run in a tokio Runtime context
    pub fn youtube_options_next_page(&mut self) {
        // this needs to be wrapped as this is not running another thread but some main-runtime thread and so needs to inform the runtime to hand-off other tasks
        // though i am not fully sure if that is 100% the case, this avoid the panic though
        tokio::task::block_in_place(move || {
            Handle::current().block_on(async {
                match self.youtube_options.next_page().await {
                    Ok(()) => self.sync_youtube_options(),
                    Err(e) => self.mount_error_popup(e.context("youtube-dl search")),
                }
            });
        });
    }

    pub fn sync_youtube_options(&mut self) {
        if self.youtube_options.items.is_empty() {
            let table = TableBuilder::default()
                .add_col(TextSpan::from("No results."))
                .add_col(TextSpan::from(
                    "Nothing was found in 10 seconds, connection issue encountered.",
                ))
                .build();
            self.app
                .attr(
                    &Id::YoutubeSearchTablePopup,
                    Attribute::Content,
                    AttrValue::Table(table),
                )
                .ok();
            return;
        }

        let mut table: TableBuilder = TableBuilder::default();
        for (idx, record) in self.youtube_options.items.iter().enumerate() {
            if idx > 0 {
                table.add_row();
            }
            let duration = DurationFmtShort(Duration::from_secs(record.length_seconds));
            let duration_string = format!("[{duration:^10.10}]");

            let title = record.title.as_str();

            table
                .add_col(TextSpan::new(duration_string))
                .add_col(TextSpan::new(title).bold());
        }
        let table = table.build();
        self.app
            .attr(
                &Id::YoutubeSearchTablePopup,
                Attribute::Content,
                AttrValue::Table(table),
            )
            .ok();

        if let Some(domain) = &self.youtube_options.invidious_instance.domain {
            let title = format!(
                "\u{2500}\u{2500}\u{2500} Page {} \u{2500}\u{2500}\u{2500}\u{2524} {} \u{251c}\u{2500}\u{2500} {} \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}",
                self.youtube_options.page(),
                "Tab/Shift+Tab switch pages",
                domain,
            );
            self.app
                .attr(
                    &Id::YoutubeSearchTablePopup,
                    Attribute::Title,
                    AttrValue::Title((title, Alignment::Left)),
                )
                .ok();
        }
    }

    #[allow(clippy::too_many_lines)]
    pub fn youtube_dl(&mut self, url: &str) -> Result<()> {
        let mut path: PathBuf = std::env::temp_dir();
        if let Ok(State::One(StateValue::String(node_id))) = self.app.state(&Id::Library) {
            path = get_parent_folder(Path::new(&node_id)).to_path_buf();
        }
        let config_tui = self.config_tui.read();
        let mut args = vec![
            Arg::new("--extract-audio"),
            // Arg::new_with_arg("--audio-format", "vorbis"),
            Arg::new_with_arg("--audio-format", "mp3"),
            Arg::new("--add-metadata"),
            Arg::new("--embed-thumbnail"),
            Arg::new_with_arg("--metadata-from-title", "%(artist) - %(title)s"),
            #[cfg(target_os = "windows")]
            Arg::new("--restrict-filenames"),
            Arg::new("--write-sub"),
            Arg::new("--all-subs"),
            Arg::new_with_arg("--convert-subs", "lrc"),
            Arg::new_with_arg("--output", "%(title).90s.%(ext)s"),
        ];
        let extra_args = parse_args(&config_tui.settings.ytdlp.extra_args)
            .context("Parsing config `extra_ytdlp_args`")?;
        let mut extra_args_parsed = convert_to_args(extra_args);
        if !extra_args_parsed.is_empty() {
            args.append(&mut extra_args_parsed);
        }

        let ytd = YoutubeDL::new(&path, args, url)?;
        let tx = self.tx_to_main.clone();

        // avoid full string clones when sending via a channel
        let url: Arc<str> = Arc::from(url);

        thread::spawn(move || -> Result<()> {
            tx.send(Msg::YoutubeSearch(YSMsg::Download(YTDLMsg::Start(
                url.clone(),
                "youtube music".to_string(),
            ))))
            .ok();
            // start download
            let download = ytd.download();

            // check what the result is and print out the path to the download or the error
            match download {
                Ok(result) => {
                    tx.send(Msg::YoutubeSearch(YSMsg::Download(YTDLMsg::Success(
                        url.clone(),
                    ))))
                    .ok();
                    // here we extract the full file name from download output
                    if let Some(file_fullname) =
                        extract_filepath(result.output(), &path.to_string_lossy())
                    {
                        tx.send(Msg::YoutubeSearch(YSMsg::Download(YTDLMsg::Completed(
                            url,
                            Some(file_fullname.clone()),
                        ))))
                        .ok();

                        // here we remove downloaded live_chat.json file
                        remove_downloaded_json(&path, &file_fullname);

                        embed_downloaded_lrc(&path, &file_fullname);
                    } else {
                        tx.send(Msg::YoutubeSearch(YSMsg::Download(YTDLMsg::Completed(
                            url, None,
                        ))))
                        .ok();
                    }
                }
                Err(e) => {
                    tx.send(Msg::YoutubeSearch(YSMsg::Download(YTDLMsg::Err(
                        url.clone(),
                        "youtube music".to_string(),
                        e.to_string(),
                    ))))
                    .ok();
                    tx.send(Msg::YoutubeSearch(YSMsg::Download(YTDLMsg::Completed(
                        url, None,
                    ))))
                    .ok();
                }
            }
            Ok(())
        });
        Ok(())
    }
}

#[cfg(feature = "youtube")]
pub type YTDLMsgURL = Arc<str>;

#[cfg(feature = "youtube")]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum YTDLMsg {
    /// Indicates a Start of a download.
    ///
    /// `(Url, Title)`
    Start(YTDLMsgURL, String),
    /// Indicates the Download was a Success, though termusic post-processing is not done yet.
    ///
    /// `(Url)`
    Success(YTDLMsgURL),
    /// Indicates the Download thread finished in both Success or Error.
    ///
    /// `(Url, Filename)`
    Completed(YTDLMsgURL, Option<String>),
    /// Indicates that the Download has Errored and has been aborted.
    ///
    /// `(Url, Title, ErrorAsString)`
    Err(YTDLMsgURL, String, String),
}

// This just parsing the output from youtubedl to get the audio path
// This is used because we need to get the song name
// example ~/path/to/song/song.mp3
#[cfg(feature = "youtube")]
fn extract_filepath(output: &str, dir: &str) -> Option<String> {
    // #[cfg(not(feature = "yt-dlp"))]
    // if let Some(cap) = RE_FILENAME.captures(output) {
    //     if let Some(c) = cap.name("name") {
    //         let filename = format!("{}/{}.mp3", dir, c.as_str());
    //         return Ok(filename);
    //     }
    // }
    // #[cfg(feature = "yt-dlp")]
    if let Some(cap) = RE_FILENAME_YTDLP.captures(output) {
        if let Some(c) = cap.name("name") {
            let filename = format!("{dir}/{}.mp3", c.as_str());
            return Some(filename);
        }
    }
    None
}

#[cfg(feature = "youtube")]
fn remove_downloaded_json(path: &Path, file_fullname: &str) {
    let files = walkdir::WalkDir::new(path).follow_links(true);
    for f in files
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|f| {
            let p = Path::new(f.file_name());
            p.extension().is_some_and(|ext| ext == "json")
        })
        .filter(|f| {
            let path_json = Path::new(f.file_name());
            let p1: &Path = Path::new(file_fullname);
            path_json.file_stem().is_some_and(|stem_lrc| {
                p1.file_stem().is_some_and(|p_base| {
                    stem_lrc
                        .to_string_lossy()
                        .contains(p_base.to_string_lossy().as_ref())
                })
            })
        })
    {
        std::fs::remove_file(f.path()).ok();
    }
}

#[cfg(feature = "youtube")]
fn embed_downloaded_lrc(path: &Path, file_fullname: &str) {
    let mut id3_tag = if let Ok(tag) = id3::Tag::read_from_path(file_fullname) {
        tag
    } else {
        let mut tags = id3::Tag::new();
        let file_path = Path::new(file_fullname);
        if let Some(p_base) = file_path.file_stem() {
            tags.set_title(p_base.to_string_lossy());
        }
        tags.write_to_path(file_path, Id3v24).ok();
        tags
    };

    // here we add all downloaded lrc file
    let files = walkdir::WalkDir::new(path).follow_links(true);

    for entry in files
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|f| f.file_type().is_file())
        .filter(|f| {
            let name = f.file_name();
            let p = Path::new(&name);
            p.extension().is_some_and(|ext| ext == "lrc")
        })
        .filter(|f| {
            let path_lrc = Path::new(f.file_name());
            let p1: &Path = Path::new(file_fullname);
            path_lrc.file_stem().is_some_and(|stem_lrc| {
                p1.file_stem().is_some_and(|p_base| {
                    stem_lrc
                        .to_string_lossy()
                        .contains(p_base.to_string_lossy().as_ref())
                })
            })
        })
    {
        let path_lrc = Path::new(entry.file_name());
        let mut lang_ext = "eng".to_string();
        if let Some(p_short) = path_lrc.file_stem() {
            let p2 = Path::new(p_short);
            if let Some(ext2) = p2.extension() {
                lang_ext = ext2.to_string_lossy().to_string();
            }
        }
        let lyric_string = std::fs::read_to_string(entry.path());
        id3_tag.add_frame(id3::frame::Lyrics {
            lang: "eng".to_string(),
            description: lang_ext,
            text: lyric_string.unwrap_or_else(|_| String::from("[00:00:01] No lyric")),
        });
        std::fs::remove_file(entry.path()).ok();
    }

    id3_tag.write_to_path(file_fullname, Id3v24).ok();
}

#[cfg(feature = "youtube")]
#[derive(Debug, Clone, PartialEq)]
enum ArgOrVal {
    ArgumentWithVal(String),
    Flag(String),
    Argument(String),
    Positional(String),
}

/// Parse the input shell-like string into a Vector of `argument` and `maybe argument value`.
#[cfg(feature = "youtube")]
fn parse_args(input: &str) -> Result<Vec<ArgOrVal>, shell_words::ParseError> {
    let result = shell_words::split(input)?
        .into_iter()
        .map(|token| {
            if token.starts_with("--") {
                if token.contains('=') {
                    ArgOrVal::ArgumentWithVal(token.to_string())
                } else {
                    ArgOrVal::Argument(token.to_string())
                }
            } else if token.starts_with('-') {
                ArgOrVal::Flag(token.to_string())
            } else {
                ArgOrVal::Positional(token.to_string())
            }
        })
        .collect();
    Ok(result)
}

/// Convert the `argument, maybe value` vector to [ytdrs Arguments](Arg).
#[cfg(feature = "youtube")]
fn convert_to_args(extra_args: Vec<ArgOrVal>) -> Vec<Arg> {
    // This capacity *may* be a little inaccurate, but should broadly reflect what we need
    let mut extra_args_parsed = Vec::with_capacity(extra_args.len());

    // store the last "maybe incomplete" argument here
    // this has to be done because ytdrs `Arg` are non-modifiable after creation.
    let mut last_arg: Option<String> = None;

    for val in extra_args {
        // push last arg to the array, before processing a new one
        match &val {
            ArgOrVal::ArgumentWithVal(_) | ArgOrVal::Argument(_) | ArgOrVal::Flag(_) => {
                if let Some(v) = last_arg.take() {
                    extra_args_parsed.push(Arg::new(&v));
                }
            }
            ArgOrVal::Positional(_) => (),
        }

        match val {
            ArgOrVal::ArgumentWithVal(v) | ArgOrVal::Flag(v) => {
                extra_args_parsed.push(Arg::new(&v));
            }
            ArgOrVal::Argument(v) => {
                last_arg = Some(v);
            }
            ArgOrVal::Positional(v) => {
                let Some(last_arg) = last_arg.take() else {
                    // in case there is a positional but no previous argument to combine with, skip the positional with a error
                    // maybe we should error instead?
                    error!("Positional without previous argument! {v:#?}");
                    continue;
                };
                extra_args_parsed.push(Arg::new_with_arg(&last_arg, &v));
            }
        }
    }

    if let Some(remainder) = last_arg {
        extra_args_parsed.push(Arg::new(&remainder));
    }

    extra_args_parsed
}

#[cfg(all(test, feature = "youtube"))]
mod tests {

    use crate::ui::model::youtube_options::extract_filepath;
    use pretty_assertions::assert_eq;

    #[test]
    fn test_youtube_output_parsing() {
        // #[cfg(not(feature = "yt-dlp"))]
        // assert_eq!(
        //     extract_filepath(
        //         r"sdflsdf [ffmpeg] Destination: 观众说“小哥哥，到饭点了”《干饭人之歌》走，端起饭盆干饭去.mp3 sldflsdfj",
        //         "/tmp"
        //     )
        //     .unwrap(),
        //     "/tmp/观众说“小哥哥，到饭点了”《干饭人之歌》走，端起饭盆干饭去.mp3".to_string()
        // );
        assert_eq!(
            extract_filepath(
                r"sdflsdf [ExtractAudio] Destination: 观众说“小哥哥，到饭点了”《干饭人之歌》走，端起饭盆干饭去.mp3 sldflsdfj",
                "/tmp"
            )
            .unwrap(),
            "/tmp/观众说“小哥哥，到饭点了”《干饭人之歌》走，端起饭盆干饭去.mp3".to_string()
        );
    }
}
