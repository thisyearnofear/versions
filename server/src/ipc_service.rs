use crate::PlayerStats;
use anyhow::{Context, Result};
use log::{error, info, trace};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use termusicplayback::{PlayerCmd, PlayerCmdSender};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;

/// MODULAR: IPC Service for remote control via Unix Domain Socket
/// Inspired by cliamp (Go) but implemented in Rust for VERSIONS
pub struct IpcService {
    cmd_tx: PlayerCmdSender,
    player_stats: Arc<Mutex<PlayerStats>>,
    socket_path: PathBuf,
}

impl IpcService {
    pub fn new(
        cmd_tx: PlayerCmdSender,
        player_stats: Arc<Mutex<PlayerStats>>,
        socket_path: PathBuf,
    ) -> Self {
        Self {
            cmd_tx,
            player_stats,
            socket_path,
        }
    }

    pub async fn run(self) -> Result<()> {
        // CLEAN: Ensure parent directory exists
        if let Some(parent) = self.socket_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        // CLEAN: Remove existing socket if it exists
        if self.socket_path.exists() {
            tokio::fs::remove_file(&self.socket_path).await?;
        }

        let listener = UnixListener::bind(&self.socket_path).context(format!(
            "Failed to bind to Unix socket: {:?}",
            self.socket_path
        ))?;

        info!("IPC Service listening on {:?}", self.socket_path);

        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let cmd_tx = self.cmd_tx.clone();
                    let player_stats = self.player_stats.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_connection(stream, cmd_tx, player_stats).await {
                            error!("IPC connection error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("IPC accept error: {}", e);
                }
            }
        }
    }
}

async fn handle_connection(
    mut stream: tokio::net::UnixStream,
    cmd_tx: PlayerCmdSender,
    player_stats: Arc<Mutex<PlayerStats>>,
) -> Result<()> {
    let (reader, mut writer) = stream.split();
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    while reader.read_line(&mut line).await? > 0 {
        let command = line.trim();
        if command.is_empty() {
            line.clear();
            continue;
        }

        trace!("IPC command received: {}", command);

        let response = match command {
            "play" => {
                let _ = cmd_tx.send(PlayerCmd::Play);
                "OK\n".to_string()
            }
            "pause" => {
                let _ = cmd_tx.send(PlayerCmd::Pause);
                "OK\n".to_string()
            }
            "toggle" => {
                let _ = cmd_tx.send(PlayerCmd::TogglePause);
                "OK\n".to_string()
            }
            "next" => {
                let _ = cmd_tx.send(PlayerCmd::SkipNext);
                "OK\n".to_string()
            }
            "prev" => {
                let _ = cmd_tx.send(PlayerCmd::SkipPrevious);
                "OK\n".to_string()
            }
            "stop" => {
                let _ = cmd_tx.send(PlayerCmd::Pause); // Assuming Pause for Stop as Stop is not available
                "OK\n".to_string()
            }
            "status" => {
                let stats = player_stats.lock();
                // Return simple JSON status
                serde_json::to_string(&*stats).unwrap_or_else(|_| "Error".to_string()) + "\n"
            }
            _ => {
                // Handle complex commands
                if command.starts_with("volume +") {
                    let _ = cmd_tx.send(PlayerCmd::VolumeUp);
                    "OK\n".to_string()
                } else if command.starts_with("volume -") {
                    let _ = cmd_tx.send(PlayerCmd::VolumeDown);
                    "OK\n".to_string()
                } else {
                    "ERROR: Unknown command\n".to_string()
                }
            }
        };

        writer.write_all(response.as_bytes()).await?;
        line.clear();
    }

    Ok(())
}
