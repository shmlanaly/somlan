const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const gTTS = require('gtts');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const port = process.env.PORT || 8080;

// تسجيل بدء التشغيل للتأكد من أن السيرفر استيقظ
console.log("=== SERVER STARTING V9.4 ===");
console.log("FFmpeg Path:", ffmpegPath);

const cleanKey = (k) => k ? k.trim() : "";

app.get('/make-viral-video', async (req, res) => {
    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);
    
    try {
        console.log("🚀 V9.4 Execution Started");
        
        // التحقق من المفاتيح الأساسية
        const GROQ_KEY = cleanKey(process.env.GROQ_API_KEY);
        const PEXELS_KEY = cleanKey(process.env.PEXELS_API);
        
        if(!GROQ_KEY || !PEXELS_KEY) throw new Error("Missing API Keys");

        // 1. إنشاء القصة (Groq)
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "قصة قصيرة (10 كلمات) بصيغة JSON: {\"title\": \"..\", \"story\": \"..\"}" }]
        }, { headers: { "Authorization": `Bearer ${GROQ_KEY}` } });

        const content = JSON.parse(groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);

        // 2. الصوت و الفيديو (بشكل متوازي للسرعة)
        const audioPath = path.join(workDir, 'audio.mp3');
        const videoPath = path.join(workDir, 'video.mp4');
        
        const audioPromise = new Promise((res, rej) => new gTTS(content.story, 'ar').save(audioPath, (e) => e ? rej(e) : res()));
        
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=nature&per_page=1`, { headers: { "Authorization": PEXELS_KEY } });
        const videoUrl = pexelsRes.data.videos[0].video_files[0].link;
        const writer = fs.createWriteStream(videoPath);
        const vidStream = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        vidStream.data.pipe(writer);
        const videoPromise = new Promise((res) => writer.on('finish', res));

        await Promise.all([audioPromise, videoPromise]);

        // 3. الدمج باستخدام FFmpeg الثابت
        const finalPath = path.join(workDir, 'final.mp4');
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, ['-y', '-i', videoPath, '-i', audioPath, '-c:v', 'copy', '-shortest', finalPath]);
            ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(`FFmpeg Fail Code ${code}`));
        });

        res.send(`✅ تم بنجاح V9.4! الفيديو جاهز (المعالجة تمت بنجاح)`);

    } catch (error) {
        console.error("V9.4 Error:", error.message);
        res.status(500).send(`❌ Error V9.4: ${error.message}`);
    } finally {
        fs.remove(workDir).catch(()=>{});
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Server is Listening on port ${port}`);
});
