const express = require('express');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');

// Beritahu fluent-ffmpeg lokasi biner ffmpeg-static
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// Endpoint untuk cek kualitas video yang tersedia
app.get('/api/video-info', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl || !ytdl.validateURL(videoUrl)) {
        return res.status(400).json({ error: 'URL YouTube tidak valid atau tidak didukung' });
    }

    try {
        const info = await ytdl.getInfo(videoUrl);
        
        // Ambil semua format yang memiliki video
        const formats = info.formats
            .filter(f => f.hasVideo)
            .map(f => ({
                qualityLabel: f.qualityLabel,
                itag: f.itag,
                hasAudio: f.hasAudio,
                container: f.container || 'mp4'
            }));

        // Hapus duplikat resolusi agar tampilan rapi
        const uniqueFormats = formats.filter((v, i, a) => a.findIndex(t => t.qualityLabel === v.qualityLabel) === i);

        res.json({
            title: info.videoDetails.title,
            thumbnail: info.videoDetails.thumbnails[0].url,
            formats: uniqueFormats
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal mengambil informasi video. Coba link lain.' });
    }
});

// Endpoint untuk memproses download
app.get('/api/download', async (req, res) => {
    const { url, itag } = req.query;

    if (!url || !itag) {
        return res.status(400).send('Parameter URL atau Kualitas salah.');
    }

    try {
        const info = await ytdl.getInfo(url);
        const format = info.formats.find(f => f.itag === parseInt(itag));
        
        // Bersihkan judul dari karakter aneh agar tidak error saat jadi nama file
        const safeTitle = info.videoDetails.title.replace(/[/\\?%*:|"<>]/g, '-'); 

        res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(safeTitle)}.mp4"`);

        // JIKA kualitas rendah (360p/720p) yang sudah ada audionya langsung dari YouTube
        if (format.hasAudio) {
            ytdl(url, { format: format }).pipe(res);
        } else {
            // JIKA 1080p (Muxing / Penggabungan Video + Audio Terpisah)
            const videoStream = ytdl(url, { quality: itag });
            const audioStream = ytdl(url, { quality: 'highestaudio' });

            ffmpeg()
                .input(videoStream)
                .input(audioStream)
                .videoCodec('copy')
                .audioCodec('aac')
                .format('mp4')
                .on('error', (err) => {
                    console.error('FFmpeg Error:', err.message);
                })
                .pipe(res, { end: true });
        }
    } catch (error) {
        console.error(error);
        if (!res.headersSent) {
            res.status(500).send('Terjadi kesalahan saat memproses unduhan.');
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});
