const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const port = process.env.PORT || 8080;

const cleanKey = (k) => k ? k.trim() : "";
const historyFile = path.join(__dirname, 'history.json');

// إدارة الذاكرة لمنع التكرار
const getHistory = () => (fs.existsSync(historyFile) ? fs.readJsonSync(historyFile) : []);
const saveToHistory = (id) => {
    const history = getHistory();
    history.push(id);
    fs.writeJsonSync(historyFile, history);
};

// إعداد يوتيوب
const youtubeAPI = google.youtube({
    version: 'v3',
    auth: cleanKey(process.env.YOUTUBE_API_KEY) // تأكد من وجود مفتاح API في Railway
});

// دالة البحث عن فيديوهات بدون حقوق (Creative Commons)
const searchCCVideo = async (query) => {
    const res = await youtubeAPI.search.list({
        part: 'snippet',
        q: query,
        videoLicense: 'creativeCommons',
        type: 'video',
        maxResults: 20
    });
    const history = getHistory();
    // اختيار فيديو لم يسبق استخدامه
    const available = res.data.items.filter(item => !history.includes(item.id.videoId));
    return available.length > 0 ? available[Math.floor(Math.random() * available.length)] : res.data.items[0];
};

// دالة تحميل الفيديو/الصوت باستخدام yt-dlp
const downloadSource = (url, outputPath, isAudio = false) => {
    const args = isAudio ? ['-x', '--audio-format', 'mp3', '-o', outputPath, url] : ['-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]', '--merge-output-format', 'mp4', '-o', outputPath, url];
    return new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', args);
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error("Download Failed")));
    });
};

app.get('/make-viral-video', async (req, res) => {
    req.setTimeout(1200000); // 20 دقيقة
    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);

    try {
        console.log("🚀 V23.0: البحث عن محتوى يوتيوب بدون حقوق...");

        // 1. البحث عن "اختراعات خشبية" و "قصة مشوقة"
        const woodVideo = await searchCCVideo("woodworking inventions satisfying no copyright");
        const storyVideo = await searchCCVideo("قصص غامضة ومثيرة بدون حقوق طبع ونشر");

        const woodUrl = `https://www.youtube.com/watch?v=${woodVideo.id.videoId}`;
        const storyUrl = `https://www.youtube.com/watch?v=${storyVideo.id.videoId}`;

        const pathTop = path.join(workDir, 'top.mp4');
        const pathBottom = path.join(workDir, 'bottom.mp4');
        const pathAudio = path.join(workDir, 'audio.mp3');
        const finalPath = path.join(workDir, 'final.mp4');

        // 2. التحميل
        console.log("📥 جاري تحميل المصادر...");
        await Promise.all([
            downloadSource(woodUrl, pathTop),
            downloadSource(storyUrl, pathBottom),
            downloadSource(storyUrl, pathAudio, true)
        ]);

        // 3. المونتاج (Split Screen + Audio Overlay)
        console.log("⚙️ جاري دمج الشاشات...");
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, [
                '-y',
                '-i', pathTop,
                '-i', pathBottom,
                '-i', pathAudio,
                '-filter_complex',
                `[0:v]scale=720:640:force_original_aspect_ratio=increase,crop=720:640[vtop];
                 [1:v]scale=720:640:force_original_aspect_ratio=increase,crop=720:640[vbottom];
                 [vtop][vbottom]vstack=inputs=2[vfinal]`,
                '-map', '[vfinal]', '-map', '2:a',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
                '-t', '55', // ضمان أن الفيديو Shorts (أقل من دقيقة)
                '-c:a', 'aac', '-shortest',
                finalPath
            ]);
            ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(new Error("FFmpeg Error")));
        });

        // 4. الرفع (يستخدم نفس كود الرفع السابق)
        // ... كود الرفع الخاص بك هنا ...

        saveToHistory(woodVideo.id.videoId);
        saveToHistory(storyVideo.id.videoId);

        res.send(`✅ تم النشر بنجاح! تم استخدام محتوى يوتيوب CC: https://youtu.be/ID_HERE`);

    } catch (error) {
        console.error(error);
        res.status(500).send(`❌ خطأ V23: ${error.message}`);
    } finally { fs.remove(workDir).catch(()=>{}); }
});

app.listen(port, () => console.log(`YouTube Factory V23 Active`));
