use std::path::{Path, PathBuf};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::fs;

/// MODULAR: Audio streaming service following our architecture patterns
#[derive(Debug, Clone)]
pub struct AudioService {
    // ORGANIZED: Audio files storage directory
    audio_directory: PathBuf,
    // PERFORMANT: Cache for audio metadata
    metadata_cache: std::collections::HashMap<String, AudioMetadata>,
}

/// CLEAN: Audio metadata structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioMetadata {
    pub file_path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_seconds: Option<u64>,
    pub file_size: u64,
    pub format: String,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
    pub bitrate: Option<u32>,
}

/// CLEAN: Audio streaming response
#[derive(Debug)]
pub struct AudioStream {
    pub content: Vec<u8>,
    pub content_type: String,
    pub content_length: u64,
    #[allow(dead_code)] // Will be used for HTTP range headers
    pub accept_ranges: bool,
}

/// CLEAN: Range request structure
#[derive(Debug)]
pub struct RangeRequest {
    pub start: u64,
    pub end: Option<u64>,
}

impl AudioService {
    /// CLEAN: Constructor following our patterns
    pub fn new(audio_directory: PathBuf) -> Self {
        Self {
            audio_directory,
            metadata_cache: std::collections::HashMap::new(),
        }
    }

    /// ENHANCEMENT: Get audio metadata with caching
    pub async fn get_audio_metadata(&mut self, file_id: &str) -> Result<AudioMetadata> {
        // PERFORMANT: Check cache first
        if let Some(metadata) = self.metadata_cache.get(file_id) {
            return Ok(metadata.clone());
        }

        let file_path = self.get_file_path(file_id)?;
        let metadata = self.extract_metadata(&file_path).await?;
        
        // PERFORMANT: Cache the result
        self.metadata_cache.insert(file_id.to_string(), metadata.clone());
        Ok(metadata)
    }

    /// MODULAR: Extract audio metadata from file
    async fn extract_metadata(&self, file_path: &Path) -> Result<AudioMetadata> {
        let file_metadata = fs::metadata(file_path).await?;
        let file_size = file_metadata.len();
        
        // CLEAN: Determine format from extension
        let format = file_path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("unknown")
            .to_lowercase();

        // TODO: Use Symphonia for detailed audio analysis
        // For now, return basic metadata
        Ok(AudioMetadata {
            file_path: file_path.to_string_lossy().to_string(),
            title: self.extract_title_from_filename(file_path),
            artist: None, // TODO: Extract from ID3 tags
            album: None,  // TODO: Extract from ID3 tags
            duration_seconds: None, // TODO: Calculate from audio data
            file_size,
            format,
            sample_rate: None, // TODO: Extract from audio data
            channels: None,    // TODO: Extract from audio data
            bitrate: None,     // TODO: Calculate from audio data
        })
    }

    /// CLEAN: Extract title from filename
    fn extract_title_from_filename(&self, file_path: &Path) -> Option<String> {
        file_path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .map(|s| s.replace('_', " ").replace('-', " "))
    }

    /// PERFORMANT: Stream audio with range support
    pub async fn stream_audio(&self, file_id: &str, range: Option<RangeRequest>) -> Result<AudioStream> {
        let file_path = self.get_file_path(file_id)?;
        let file_metadata = fs::metadata(&file_path).await?;
        let file_size = file_metadata.len();

        let content_type = self.get_content_type(&file_path);

        match range {
            Some(range_req) => {
                // PERFORMANT: Handle range requests for efficient streaming
                let start = range_req.start;
                let end = range_req.end.unwrap_or(file_size - 1).min(file_size - 1);
                
                let mut file = File::open(&file_path)?;
                file.seek(SeekFrom::Start(start))?;
                
                let content_length = end - start + 1;
                let mut content = vec![0u8; content_length as usize];
                file.read_exact(&mut content)?;

                Ok(AudioStream {
                    content,
                    content_type,
                    content_length,
                    accept_ranges: true,
                })
            }
            None => {
                // CLEAN: Full file streaming
                let content = fs::read(&file_path).await?;
                
                Ok(AudioStream {
                    content_length: content.len() as u64,
                    content,
                    content_type,
                    accept_ranges: true,
                })
            }
        }
    }

    /// MODULAR: Get file path from ID
    fn get_file_path(&self, file_id: &str) -> Result<PathBuf> {
        // CLEAN: Sanitize file ID to prevent directory traversal
        let sanitized_id = file_id.replace(['/', '\\'], "").replace("..", "");
        
        // ORGANIZED: Look for file in audio directory
        let extensions = ["mp3", "flac", "wav", "m4a", "ogg", "aiff"];
        
        for ext in &extensions {
            let file_path = self.audio_directory.join(format!("{}.{}", sanitized_id, ext));
            if file_path.exists() {
                return Ok(file_path);
            }
        }
        
        Err(anyhow::anyhow!("Audio file not found: {}", file_id))
    }

    /// CLEAN: Get MIME content type for audio file
    fn get_content_type(&self, file_path: &Path) -> String {
        match file_path.extension().and_then(|ext| ext.to_str()) {
            Some("mp3") => "audio/mpeg",
            Some("flac") => "audio/flac",
            Some("wav") => "audio/wav",
            Some("m4a") => "audio/mp4",
            Some("ogg") => "audio/ogg",
            Some("aiff") => "audio/aiff",
            _ => "application/octet-stream",
        }.to_string()
    }

    /// MODULAR: List available audio files
    pub async fn list_audio_files(&self) -> Result<Vec<String>> {
        let mut files = Vec::new();
        let mut entries = fs::read_dir(&self.audio_directory).await?;
        
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.is_file() {
                if let Some(extension) = path.extension().and_then(|ext| ext.to_str()) {
                    let ext_lower = extension.to_lowercase();
                    if ["mp3", "flac", "wav", "m4a", "ogg", "aiff"].contains(&ext_lower.as_str()) {
                        if let Some(file_stem) = path.file_stem().and_then(|stem| stem.to_str()) {
                            files.push(file_stem.to_string());
                        }
                    }
                }
            }
        }
        
        files.sort();
        Ok(files)
    }

    /// ENHANCEMENT: Upload audio file
    pub async fn upload_audio_file(&self, file_id: &str, content: Vec<u8>, format: &str) -> Result<AudioMetadata> {
        // CLEAN: Validate format
        let valid_formats = ["mp3", "flac", "wav", "m4a", "ogg", "aiff"];
        if !valid_formats.contains(&format.to_lowercase().as_str()) {
            return Err(anyhow::anyhow!("Unsupported audio format: {}", format));
        }

        // ORGANIZED: Save file to audio directory
        let file_path = self.audio_directory.join(format!("{}.{}", file_id, format));
        fs::write(&file_path, content).await?;

        // MODULAR: Extract and return metadata
        self.extract_metadata(&file_path).await
    }
}

impl Default for AudioService {
    fn default() -> Self {
        // ORGANIZED: Default audio directory
        let audio_dir = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("audio_files");
        
        Self::new(audio_dir)
    }
}