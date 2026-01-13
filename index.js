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

const cleanKey = (k) => k ? k.trim() : "";

// دالة إعداد يوتيوب المصفحة
const getYoutubeClient = () => {
    try {
        const rawTokens = cleanKey(process.env.TOKENS);
        if (!rawTokens) throw new Error("متغير TOKENS مفقود تماماً من إعدادات Railway");

        let tokens;
        try {
            tokens = JSON.parse(rawTokens);
        } catch (e) {
            console.log("Tokens not JSON, trying as string");
            tokens = { refresh_token: rawTokens };
        }

        const clientID = cleanKey(process.env.CLIENT_ID);
        const clientSecret = cleanKey(process.env.CLIENT_SECRET);

        if (!clientID || !clientSecret) throw new Error("ClientID أو ClientSecret مفقود");

        const oauth2Client = new google.auth.OAuth2(
            clientID,
            clientSecret,
            "https://developers.google.com/oauthplayground"
        );
        oauth2Client.setCredentials(tokens);
        return google.youtube({ version: 'v3', auth: oauth2Client });
    } catch (e) {
        throw new Error("خطأ في تهيئة يوتيوب: " + e.message);
    }
};

app.get('/make-viral-video', async (req, res) => {
    req.setTimeout(600000); 
    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);
    
    try {
        console.log("🎬 V10.1: التحقق من اليوتيوب...");
        const youtube = getYoutubeClient();

        console.log("🚀 V10.1: توليد المحتوى...");
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "حقيقة قصيرة جدا (10 كلمات) بصيغة JSON: {\"title\": \"..\", \"story\": \"..\"}" }]
        }, { headers: { "Authorization": `Bearer ${cleanKey(process.env.GROQ_API_KEY)}` } });
        
        const content = JSON.parse(groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);

        const audioPath = path.join(workDir, 'audio.mp3');
        const videoPath = path.join(workDir, 'video.mp4');
        
        await Promise.all([
            new Promise((res, rej) => new gTTS(content.story, 'ar').save(audioPath, (e) => e ? rej(e) : res())),
            (async () => {
                const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=nature&per_page=1`, { 
                    headers: { "Authorization": cleanKey(process.env.PEXELS_API) } 
                });
                const writer = fs.createWriteStream(videoPath);
                const vid = await axios({ url: pexelsRes.data.videos[0].video_files[0].link, method: 'GET', responseType: 'stream' });
                vid.data.pipe(writer);
                return new Promise((res) => writer.on('finish', res));
            })()
        ]);

        const finalPath = path.join(workDir, 'final.mp4');
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, ['-y', '-i', videoPath, '-i', audioPath, '-c:v', 'libx264', '-preset', 'ultrafast', '-shortest', finalPath]);
            ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(new Error("FFmpeg فشل بكود: " + code)));
        });

        console.log("⬆️ V10.1: جاري الرفع...");
        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: content.title, description: content.story + " #shorts" },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        res.send(`✅ تم بنجاح V10.1! الرابط: https://youtu.be/${uploadRes.data.id}`);

    } catch (error) {
        console.error("V10.1 Catch:", error);
        res.status(500).send(`❌ خطأ V10.1 مفصل: ${error.message || error}`);
    } finally {
        fs.remove(workDir).catch(()=>{});
    }
});

app.listen(port, '0.0.0.0', () => console.log(`V10.1 Debugger Ready`));
