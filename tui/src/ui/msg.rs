//! This Module contains all TUI-specific message types.

use std::path::PathBuf;

use image::DynamicImage;
use termusiclib::config::v2::tui::{keys::KeyBinding, theme::styles::ColorTermusic};
use termusiclib::podcast::{PodcastDLResult, PodcastFeed, PodcastSyncResult};
use termusiclib::songtag::{SongtagSearchResult, TrackDLMsg};

use crate::ui::ids::{IdConfigEditor, IdKey, IdKeyGlobal, IdKeyOther};

/// Main message type that encapsulates everything else.
// Note that the style is for each thing to have a sub-type, unless it is top-level like "ForceRedraw".
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Msg {
    ConfigEditor(ConfigEditorMsg),
    DataBase(DBMsg),
    Notification(NotificationMsg),
    GeneralSearch(GSMsg),
    Layout(MainLayoutMsg),
    Library(LIMsg),
    Player(PlayerMsg),
    Playlist(PLMsg),
    Podcast(PCMsg),
    SavePlaylist(SavePlaylistMsg),
    TagEditor(TEMsg),
    Xywh(XYWHMsg),
    LyricMessage(LyricMsg),
    DeleteConfirm(DeleteConfirmMsg),
    QuitPopup(QuitPopupMsg),
    HelpPopup(HelpPopupMsg),
    ErrorPopup(ErrorPopupMsg),

    /// Same as [`ForceRedraw`](Msg::ForceRedraw), but also updated the drawn cover.
    UpdatePhoto,
    /// Force a redraw because of some change.
    ///
    /// This is necessary as `Components` do not have access to `Model.redraw`.
    ///
    /// For example pushing ARROW DOWN to change the selection in a table.
    ///
    /// Note that this message does *not* update the drawn cover.
    ForceRedraw,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MainLayoutMsg {
    /// Switch to the Music library view
    TreeView,
    /// Switch to the Database view
    DataBase,
    /// Switch to the Podcast view
    Podcast,
}

/// Player relates messages
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerMsg {
    ToggleGapless,
    TogglePause,
    VolumeUp,
    VolumeDown,
    SpeedUp,
    SpeedDown,
    SeekForward,
    SeekBackward,
}

/// Save Playlist Popup related messages
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SavePlaylistMsg {
    PopupShow,
    PopupCloseCancel,
    PopupUpdate(String),
    PopupCloseOk(String),
    ConfirmCloseCancel,
    ConfirmCloseOk(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum XYWHMsg {
    /// Toggle the hidden / shown status of the displayed image.
    ToggleHidden,
    MoveLeft,
    MoveRight,
    MoveUp,
    MoveDown,
    ZoomIn,
    ZoomOut,

    CoverDLResult(CoverDLResult),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoverDLResult {
    // TODO: The Following 2 things have absolutely nothing to-do with Download
    /// Fetching & loading the image was a success, with the image.
    FetchPhotoSuccess(ImageWrapper),
    /// Fetching & loading the image has failed, with error message.
    /// `(ErrorAsString)`
    FetchPhotoErr(String),
}

#[derive(Clone, PartialEq, Debug)]
pub struct ImageWrapper {
    pub data: DynamicImage,
}
impl Eq for ImageWrapper {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeleteConfirmMsg {
    CloseCancel,
    CloseOk,
    Show,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QuitPopupMsg {
    /// Closes the Quit Popup, if it was shown without quitting.
    CloseCancel,
    /// Always will directly quit.
    CloseOk,
    /// Either shows the Quit Dialog if enabled, or if dialog is disabled, directly quits
    Show,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HelpPopupMsg {
    Show,
    Close,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErrorPopupMsg {
    Close,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LyricMsg {
    Cycle,
    AdjustDelay(i64),

    TextAreaBlurUp,
    TextAreaBlurDown,
}

/// Basically a Tree Node, but without having to include `tui-realm-treeview` as another dependency for lib
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecVec<T, V> {
    pub id: T,
    pub value: V,
    pub children: Vec<RecVec<T, V>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LIMsg {
    TreeStepInto(String),
    TreeStepOut,
    TreeBlur,
    Yank,
    Paste,
    SwitchRoot,
    AddRoot,
    RemoveRoot,

    /// A requested node is ready from loading.
    /// `(Tree, FocusNode)`
    TreeNodeReady(RecVec<PathBuf, String>, Option<String>),
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ConfigEditorMsg {
    PodcastDirBlurDown,
    PodcastDirBlurUp,
    PodcastSimulDownloadBlurDown,
    PodcastSimulDownloadBlurUp,
    PodcastMaxRetriesBlurDown,
    PodcastMaxRetriesBlurUp,

    AlbumPhotoAlignBlurDown,
    AlbumPhotoAlignBlurUp,
    ChangeLayout,
    CloseCancel,
    CloseOk,
    ColorChanged(IdConfigEditor, ColorTermusic),
    SymbolChanged(IdConfigEditor, String),
    ConfigChanged,
    ConfigSaveOk,
    ConfigSaveCancel,
    ExitConfirmationBlurDown,
    ExitConfirmationBlurUp,
    Open,
    KeyFocusGlobal(KFMsg),
    KeyFocusOther(KFMsg),
    MusicDirBlurDown,
    MusicDirBlurUp,

    PlaylistDisplaySymbolBlurDown,
    PlaylistDisplaySymbolBlurUp,
    PlaylistRandomTrackBlurDown,
    PlaylistRandomTrackBlurUp,
    PlaylistRandomAlbumBlurDown,
    PlaylistRandomAlbumBlurUp,

    LibraryForegroundBlurDown,
    LibraryForegroundBlurUp,
    LibraryBackgroundBlurDown,
    LibraryBackgroundBlurUp,
    LibraryBorderBlurDown,
    LibraryBorderBlurUp,
    LibraryHighlightBlurDown,
    LibraryHighlightBlurUp,
    LibraryHighlightSymbolBlurDown,
    LibraryHighlightSymbolBlurUp,

    PlaylistForegroundBlurDown,
    PlaylistForegroundBlurUp,
    PlaylistBackgroundBlurDown,
    PlaylistBackgroundBlurUp,
    PlaylistBorderBlurDown,
    PlaylistBorderBlurUp,
    PlaylistHighlightBlurDown,
    PlaylistHighlightBlurUp,
    PlaylistHighlightSymbolBlurDown,
    PlaylistHighlightSymbolBlurUp,

    ProgressForegroundBlurDown,
    ProgressForegroundBlurUp,
    ProgressBackgroundBlurDown,
    ProgressBackgroundBlurUp,
    ProgressBorderBlurDown,
    ProgressBorderBlurUp,

    LyricForegroundBlurDown,
    LyricForegroundBlurUp,
    LyricBackgroundBlurDown,
    LyricBackgroundBlurUp,
    LyricBorderBlurDown,
    LyricBorderBlurUp,

    ThemeSelectBlurDown,
    ThemeSelectBlurUp,
    ThemeSelectLoad(usize),

    KeyChange(IdKey, KeyBinding),
    SaveLastPositionBlurDown,
    SaveLastPosotionBlurUp,
    SeekStepBlurDown,
    SeekStepBlurUp,
    KillDaemonBlurDown,
    KillDaemonBlurUp,

    PlayerUseMprisBlurDown,
    PlayerUseMprisBlurUp,
    PlayerUseDiscordBlurDown,
    PlayerUseDiscordBlurUp,
    PlayerPortBlurUp,

    CurrentlyPlayingTrackSymbolBlurDown,
    CurrentlyPlayingTrackSymbolBlurUp,

    ImportantPopupForegroundBlurDown,
    ImportantPopupForegroundBlurUp,
    ImportantPopupBackgroundBlurDown,
    ImportantPopupBackgroundBlurUp,
    ImportantPopupBorderBlurDown,
    ImportantPopupBorderBlurUp,

    FallbackForegroundBlurDown,
    FallbackForegroundBlurUp,
    FallbackBackgroundBlurDown,
    FallbackBackgroundBlurUp,
    FallbackBorderBlurDown,
    FallbackBorderBlurUp,
    FallbackHighlightBlurDown,
    FallbackHighlightBlurUp,
}

/// This array defines the order the IDs listed are displayed and which gains next / previous focus.
pub const KFGLOBAL_FOCUS_ORDER: &[IdKey] = &[
    // main layouts
    IdKey::Global(IdKeyGlobal::LayoutTreeview),
    IdKey::Global(IdKeyGlobal::LayoutDatabase),
    IdKey::Global(IdKeyGlobal::LayoutPodcast),
    // general global keys
    IdKey::Global(IdKeyGlobal::Quit),
    IdKey::Global(IdKeyGlobal::Config),
    IdKey::Global(IdKeyGlobal::Help),
    IdKey::Global(IdKeyGlobal::SavePlaylist),
    // global navigation
    IdKey::Global(IdKeyGlobal::Up),
    IdKey::Global(IdKeyGlobal::Down),
    IdKey::Global(IdKeyGlobal::Left),
    IdKey::Global(IdKeyGlobal::Right),
    IdKey::Global(IdKeyGlobal::GotoBottom),
    IdKey::Global(IdKeyGlobal::GotoTop),
    // global player controls
    IdKey::Global(IdKeyGlobal::PlayerToggleGapless),
    IdKey::Global(IdKeyGlobal::PlayerTogglePause),
    IdKey::Global(IdKeyGlobal::PlayerNext),
    IdKey::Global(IdKeyGlobal::PlayerPrevious),
    IdKey::Global(IdKeyGlobal::PlayerSeekForward),
    IdKey::Global(IdKeyGlobal::PlayerSeekBackward),
    IdKey::Global(IdKeyGlobal::PlayerSpeedUp),
    IdKey::Global(IdKeyGlobal::PlayerSpeedDown),
    IdKey::Global(IdKeyGlobal::PlayerVolumeUp),
    IdKey::Global(IdKeyGlobal::PlayerVolumeDown),
    // lyric controls
    IdKey::Global(IdKeyGlobal::LyricAdjustForward),
    IdKey::Global(IdKeyGlobal::LyricAdjustBackward),
    IdKey::Global(IdKeyGlobal::LyricCycle),
    // coverart display adjustments
    IdKey::Global(IdKeyGlobal::XywhMoveUp),
    IdKey::Global(IdKeyGlobal::XywhMoveDown),
    IdKey::Global(IdKeyGlobal::XywhMoveLeft),
    IdKey::Global(IdKeyGlobal::XywhMoveRight),
    IdKey::Global(IdKeyGlobal::XywhZoomIn),
    IdKey::Global(IdKeyGlobal::XywhZoomOut),
    IdKey::Global(IdKeyGlobal::XywhHide),
];

/// This array defines the order the IDs listed are displayed and which gains next / previous focus.
pub const KFOTHER_FOCUS_ORDER: &[IdKey] = &[
    // library keys
    IdKey::Other(IdKeyOther::LibraryAddRoot),
    IdKey::Other(IdKeyOther::LibraryRemoveRoot),
    IdKey::Other(IdKeyOther::LibrarySwitchRoot),
    IdKey::Other(IdKeyOther::LibraryDelete),
    IdKey::Other(IdKeyOther::LibraryLoadDir),
    IdKey::Other(IdKeyOther::LibraryYank),
    IdKey::Other(IdKeyOther::LibraryPaste),
    IdKey::Other(IdKeyOther::LibrarySearch),
    IdKey::Other(IdKeyOther::LibraryTagEditor),
    // playlist keys
    IdKey::Other(IdKeyOther::PlaylistShuffle),
    IdKey::Other(IdKeyOther::PlaylistModeCycle),
    IdKey::Other(IdKeyOther::PlaylistPlaySelected),
    IdKey::Other(IdKeyOther::PlaylistSearch),
    IdKey::Other(IdKeyOther::PlaylistSwapUp),
    IdKey::Other(IdKeyOther::PlaylistSwapDown),
    IdKey::Other(IdKeyOther::PlaylistDelete),
    IdKey::Other(IdKeyOther::PlaylistDeleteAll),
    IdKey::Other(IdKeyOther::PlaylistAddRandomAlbum),
    IdKey::Other(IdKeyOther::PlaylistAddRandomTracks),
    // database keys
    IdKey::Other(IdKeyOther::DatabaseAddAll),
    IdKey::Other(IdKeyOther::DatabaseAddSelected),
    // podcast keys
    IdKey::Other(IdKeyOther::PodcastSearchAddFeed),
    IdKey::Other(IdKeyOther::PodcastMarkPlayed),
    IdKey::Other(IdKeyOther::PodcastMarkAllPlayed),
    IdKey::Other(IdKeyOther::PodcastEpDownload),
    IdKey::Other(IdKeyOther::PodcastEpDeleteFile),
    IdKey::Other(IdKeyOther::PodcastDeleteFeed),
    IdKey::Other(IdKeyOther::PodcastDeleteAllFeeds),
    IdKey::Other(IdKeyOther::PodcastRefreshFeed),
    IdKey::Other(IdKeyOther::PodcastRefreshAllFeeds),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KFMsg {
    Next,
    Previous,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DBMsg {
    /// Add all Track Results (from view `Tracks`) to the playlist
    AddAllToPlaylist,
    /// Add a single Track Result (from view `Tracks`) to the playlist
    AddPlaylist(usize),
    /// Add all Results (from view `Result`) to the playlist
    AddAllResultsToPlaylist,
    /// Add a single result (from view `Result`) to the playlist
    AddResultToPlaylist(usize),
    CriteriaBlurDown,
    CriteriaBlurUp,
    /// Search Results (for view `Result`) from a `Database`(view) index
    SearchResult(SearchCriteria),
    SearchResultBlurDown,
    SearchResultBlurUp,
    /// Serarch Tracks (for view `Tracks`) from a `Result`(view) index
    SearchTrack(usize),
    SearchTracksBlurDown,
    SearchTracksBlurUp,

    AddAllResultsConfirmShow,
    AddAllResultsConfirmCancel,
}

/// Playlist Library View messages
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PLMsg {
    NextSong,
    PrevSong,
    /// Change focus to the next view
    PlaylistTableBlurDown,
    /// Change focus to the previous view
    PlaylistTableBlurUp,
    /// Add a directory / file to the playlist
    Add(PathBuf),
    /// Remove INDEX from playlist
    Delete(usize),
    /// Clear the Playlist
    DeleteAll,
    /// Select the next mode in the list
    ///
    /// see `termusicplayback::playlist::Loop` for all modes
    LoopModeCycle,
    /// Play a specific index
    PlaySelected(usize),
    /// Shuffle the current items in the playlist
    Shuffle,
    /// Swap a entry at INDEX with +1 (down)
    SwapDown(usize),
    /// Swap a entry at INDEX with -1 (up)
    SwapUp(usize),
    /// Start choosing random albums to be added to the playlist
    AddRandomAlbum,
    /// Start choosing random tracks to be added to the playlist
    AddRandomTracks,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GSMsg {
    PopupShowDatabase,
    PopupShowLibrary,
    PopupShowPlaylist,
    PopupShowEpisode,
    PopupShowPodcast,
    PopupCloseCancel,
    InputBlur,
    PopupUpdateDatabase(String),
    PopupUpdateLibrary(String),
    PopupUpdatePlaylist(String),
    PopupUpdateEpisode(String),
    PopupUpdatePodcast(String),
    TableBlur,
    PopupCloseEpisodeAddPlaylist,
    PopupCloseDatabaseAddPlaylist,
    PopupCloseLibraryAddPlaylist,
    PopupCloseOkLibraryLocate,
    PopupClosePlaylistPlaySelected,
    PopupCloseOkPlaylistLocate,
    PopupCloseOkEpisodeLocate,
    PopupCloseOkPodcastLocate,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum YSMsg {
    InputPopupShow,
    InputPopupCloseCancel,
    InputPopupCloseOk(String),
    TablePopupNext,
    TablePopupPrevious,
    TablePopupCloseCancel,
    TablePopupCloseOk(usize),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TEMsg {
    Open(String),
    Close,
    CounterDeleteOk,
    Download(usize),
    Embed(usize),
    Focus(TFMsg),
    Save,
    Search,
    SelectLyricOk(usize),

    SearchLyricResult(SongtagSearchResult),
    TrackDownloadResult(TrackDLMsg),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TFMsg {
    CounterDeleteBlurDown,
    CounterDeleteBlurUp,
    InputArtistBlurDown,
    InputArtistBlurUp,
    InputTitleBlurDown,
    InputTitleBlurUp,
    InputAlbumBlurDown,
    InputAlbumBlurUp,
    InputGenreBlurDown,
    InputGenreBlurUp,
    SelectLyricBlurDown,
    SelectLyricBlurUp,
    TableLyricOptionsBlurDown,
    TableLyricOptionsBlurUp,
    TextareaLyricBlurDown,
    TextareaLyricBlurUp,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PCMsg {
    PodcastBlurDown,
    PodcastBlurUp,

    EpisodeBlurDown,
    EpisodeBlurUp,

    PodcastAddPopupShow,
    PodcastAddPopupCloseOk(String),
    PodcastAddPopupCloseCancel,
    PodcastSelected(usize),
    DescriptionUpdate,
    EpisodeAdd(usize),
    EpisodeMarkPlayed(usize),
    EpisodeMarkAllPlayed,
    PodcastRefreshOne(usize),
    PodcastRefreshAll,
    EpisodeDownload(usize),
    EpisodeDeleteFile(usize),

    FeedDeleteShow,
    FeedDeleteCloseOk,
    FeedDeleteCloseCancel,
    FeedsDeleteShow,
    FeedsDeleteCloseOk,
    FeedsDeleteCloseCancel,

    SearchItunesCloseCancel,
    SearchItunesCloseOk(usize),
    SearchSuccess(Vec<PodcastFeed>),
    SearchError(String),

    SyncResult(PodcastSyncResult),
    DLResult(PodcastDLResult),
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum NotificationMsg {
    // TODO: The Following 2 things have absolutely nothing to-do with Download
    /// Show a status message in the TUI.
    ///
    /// `((Title, Text))`
    MessageShow((String, String)),
    /// Hide a status message in the TUI.
    ///
    /// `((Title, Text))`
    MessageHide((String, String)),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchCriteria {
    Artist,
    Album,

    // TODO: the values below are current unused
    Genre,
    Directory,
    Playlist,
}

impl SearchCriteria {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            SearchCriteria::Artist => "artist",
            SearchCriteria::Album => "album",
            SearchCriteria::Genre => "genre",
            SearchCriteria::Directory => "directory",
            SearchCriteria::Playlist => "playlist",
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ui::ids::IdKey;

    use super::{KFGLOBAL_FOCUS_ORDER, KFOTHER_FOCUS_ORDER};

    // ensure that assumptions about "KFGLOBAL_FOCUS_ORDER[0]" can be made correctly
    #[test]
    // clippy complains that it is always "false", but if the array actually *is* empty, then rust will **NOT** complain on "[0]" access
    #[allow(clippy::const_is_empty)]
    fn kfglobal_focus_order_should_be_nonzero() {
        assert!(!KFGLOBAL_FOCUS_ORDER.is_empty());
    }

    // i dont think there is a compile-time way to ensure only a specific enum variant is used, so test here
    #[test]
    fn kfglobal_focus_order_should_only_contain_global() {
        for entry in KFGLOBAL_FOCUS_ORDER {
            assert_eq!(
                std::mem::discriminant(entry),
                std::mem::discriminant(&IdKey::Global(crate::ui::ids::IdKeyGlobal::Config))
            );
        }
    }

    // ensure that assumptions about "KFOTHER_FOCUS_ORDER[0]" can be made correctly
    #[test]
    // clippy complains that it is always "false", but if the array actually *is* empty, then rust will **NOT** complain on "[0]" access
    #[allow(clippy::const_is_empty)]
    fn kfother_focus_order_should_be_nonzero() {
        assert!(!KFOTHER_FOCUS_ORDER.is_empty());
    }

    // i dont think there is a compile-time way to ensure only a specific enum variant is used, so test here
    #[test]
    fn kfother_focus_order_should_only_contain_other() {
        for entry in KFOTHER_FOCUS_ORDER {
            assert_eq!(
                std::mem::discriminant(entry),
                std::mem::discriminant(&IdKey::Other(crate::ui::ids::IdKeyOther::DatabaseAddAll))
            );
        }
    }
}
