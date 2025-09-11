use clap::{ArgAction, Parser, Subcommand, ValueEnum, builder::ArgPredicate};
use std::path::PathBuf;
use termusiclib::config::v2::server::Backend as ConfigBackend;

#[derive(Parser, Debug)]
// mostly read from `Cargo.toml`
#[clap(name = "VERSIONS", author, version = env!("TERMUSIC_VERSION"), about, long_about=None)]
pub struct Args {
    /// Subcommands, overwriting default action of starting the TUI
    #[command(subcommand)]
    pub action: Option<Action>,
    /// With no `MUSIC_DIRECTORY`, use config in `~/.config/versions/config.toml`,
    /// default is ~/Music.
    pub music_directory: Option<PathBuf>,
    /// Not showing album cover. default is showing.
    #[arg(short = 'c', long)]
    pub hide_cover: bool,
    /// Disable cover support, even if compiled-in.
    #[arg(long)]
    pub disable_cover: bool,
    /// Not showing discord representation. default is showing.
    #[arg(short, long)]
    pub disable_discord: bool,
    /// Max depth(NUMBER) of folder, default is 4.
    #[arg(short, long)]
    pub max_depth: Option<u32>,
    /// Select the backend, default is `rusty`
    #[arg(short, long, env = "TMS_BACKEND")]
    pub backend: Option<Backend>,
    #[clap(flatten)]
    pub log_options: LogOptions,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum Backend {
    Rusty,
    Mpv,
    #[value(alias = "gst", name = "gstreamer")]
    GStreamer,
}

impl From<Backend> for ConfigBackend {
    fn from(value: Backend) -> Self {
        match value {
            Backend::Rusty => Self::Rusty,
            Backend::Mpv => Self::Mpv,
            Backend::GStreamer => Self::Gstreamer,
        }
    }
}

impl Backend {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        // reuse the config "as_str" impl
        <Self as Into<ConfigBackend>>::into(self).as_str()
    }
}

impl std::fmt::Display for Backend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Subcommands for the binary
#[derive(Subcommand, Debug)]
pub enum Action {
    /// Import Podcast feeds from a opml file.
    Export {
        #[arg(value_name = "FILE")]
        file: PathBuf,
    },
    /// Export Podcast feeds to a opml file.
    Import {
        #[arg(value_name = "FILE")]
        file: PathBuf,
    },
}

const DEFAULT_LOGFILE_FILENAME: &str = "versions-tui.log";

#[derive(Debug, Parser, Clone, PartialEq)]
pub struct LogOptions {
    /// Enable logging to a file,
    /// automatically enabled if "log-file" is manually set
    #[arg(
        long = "log-to-file",
        env = "TM_LOGTOFILE",
        // automatically enable "log-to-file" if "log-file" is set, unless explicitly told not to
        default_value_if("log_file", ArgPredicate::IsPresent, "true"),
        action = ArgAction::Set,
        default_value_t = true,
        // somehow clap has this option not properly supported in derive, so it needs to be a string
        default_missing_value = "true",
        num_args = 0..=1,
        require_equals = true,
    )]
    pub log_to_file: bool,

    /// Set logging file
    #[arg(long = "log-file", default_value_os_t = default_logfile_path(), env = "TM_LOGFILE")]
    pub log_file: PathBuf,

    /// Use colored logging for files
    /// Example: live tailing via `tail -f /logfile`
    #[arg(long = "log-filecolor", env = "TM_LOGFILE_COLOR")]
    pub file_color_log: bool,
}

fn default_logfile_path() -> PathBuf {
    std::env::temp_dir().join(DEFAULT_LOGFILE_FILENAME)
}
