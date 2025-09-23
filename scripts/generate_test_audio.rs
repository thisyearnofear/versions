#!/usr/bin/env cargo script
//! ```cargo
//! [dependencies]
//! hound = "3.5"
//! ```

// CLEAN: Pure Rust test audio generation for development
// PREVENT BLOAT: No external FFmpeg dependency needed

use std::f32::consts::PI;
use std::fs::File;
use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let spec = hound::WavSpec {
        channels: 2,
        sample_rate: 44100,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    
    let mut writer = hound::WavWriter::create("test-upload.wav", spec)?;
    
    // Generate 3 seconds of 440Hz tone (A4)
    let sample_rate = 44100.0;
    let frequency = 440.0;
    let duration = 3.0;
    let samples = (sample_rate * duration) as usize;
    
    for i in 0..samples {
        let t = i as f32 / sample_rate;
        let sample = (t * frequency * 2.0 * PI).sin();
        let amplitude = (sample * i16::MAX as f32) as i16;
        
        // Write stereo (both channels same)
        writer.write_sample(amplitude)?;
        writer.write_sample(amplitude)?;
    }
    
    writer.finalize()?;
    println!("Generated test-upload.wav (3 seconds, 440Hz tone)");
    Ok(())
}