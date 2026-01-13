const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const gTTS = require('gtts');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static'); // استخدام النسخة الثابتة
const fs = require('fs-extra');
const path = require('path');
const app = express();
const port = process.env.PORT || 8080;

const cleanKey = (k) => k ? k.trim() : "";
const getTokens = () => {
    const raw = cleanKey(process.env.TOKENS);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return { refresh_token: raw }; }
};

const GROQ_KEY = cleanKey(process.env.GROQ_API_KEY);
const PEXELS_KEY = cleanKey(process.env.PEXELS_API);

let youtube;
try {
    const tokens = getTokens();
    if (tokens) {
        const oauth2Client = new google.auth.OAuth2(
            cleanKey(process.env.CLIENT_ID),
            cleanKey(process.env.CLIENT_SECRET),
            "https://developers.google.com/oauthplayground"
        );
        oauth2Client.setCredentials(tokens);
        youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    }
} catch (error) { console.error("YouTube Init Error"); }

app.get('/make-viral-video', async (req, res) => {
    req.setTimeout(300000);
    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);
    
    try {
        console.log("🚀 V9.3 Running with Static FFmpeg...");
        if (!youtube) throw new Error("YouTube Configuration Missing");

        // 1. القصة
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "قصة علمية مذهلة (15 كلمة) بصيغة JSON: {\"title\": \"...\", \"story\": \"...\"}" }]
        }, { headers: { "Authorization": `Bearer ${GROQ_KEY}` } });
        
        let content = JSON.parse(groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);

        // 2. الصوت
        const audioPath = path.join(workDir, 'audio.mp3');
        await new Promise((res, rej) => new gTTS(content.story, 'ar').save(audioPath, (e) => e ? rej(e) : res()));

        // 3. الفيديو
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=nature&orientation=portrait&size=small&per_page=1`, {
            headers: { "Authorization": PEXELS_KEY }
        });
        const videoPath = path.join(workDir, 'video.mp4');
        const writer = fs.createWriteStream(videoPath);
        const vidStream = await axios({ url: pexelsRes.data.videos[0].video_files[0].link, method: 'GET', responseType: 'stream' });
        vidStream.data.pipe(writer);
        await new Promise((res) => writer.on('finish', res));

        // 4. الدمج (باستخدام المسار الثابت الجديد)
        const finalPath = path.join(workDir, 'final.mp4');
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, [ // استخدام ffmpegPath المستورد
                '-y', '-i', videoPath, '-i', audioPath,
                '-map', '0:v', '-map', '1:a',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-shortest',
                finalPath
            ]);
            ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(`FFmpeg Error: ${code}`));
        });

        // 5. الرفع
        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: content.title, description: content.story + " #shorts" },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        res.send(`✅ تم بنجاح V9.3! الفيديو: https://youtu.be/${uploadRes.data.id}`);

    } catch (error) {
        res.status(500).send(`❌ خطأ V9.3: ${error.message}`);
    } finally {
        fs.remove(workDir).catch(()=>{});
    }
});

app.listen(port, '0.0.0.0', () => console.log(`Stable V9.3 Running`));
