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

// إعداد يوتيوب
const getYoutubeClient = () => {
    try {
        const rawTokens = cleanKey(process.env.TOKENS);
        const tokens = rawTokens.startsWith('{') ? JSON.parse(rawTokens) : { refresh_token: rawTokens };
        
        const oauth2Client = new google.auth.OAuth2(
            cleanKey(process.env.CLIENT_ID),
            cleanKey(process.env.CLIENT_SECRET),
            "https://developers.google.com/oauthplayground"
        );
        oauth2Client.setCredentials(tokens);
        return google.youtube({ version: 'v3', auth: oauth2Client });
    } catch (e) {
        console.error("YouTube Init Failed:", e.message);
        return null;
    }
};

app.get('/make-viral-video', async (req, res) => {
    req.setTimeout(600000); // رفع المهلة لـ 10 دقائق
    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);
    
    try {
        const youtube = getYoutubeClient();
        if (!youtube) throw new Error("فشل إعداد اتصال يوتيوب - تحقق من TOKENS");

        console.log("🎬 V10.0: بدأت عملية الإنتاج...");

        // 1. ذكاء اصطناعي (Groq)
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "اعطني حقيقة مذهلة (15 كلمة) بصيغة JSON: {\"title\": \"..\", \"story\": \"..\"}" }]
        }, { headers: { "Authorization": `Bearer ${cleanKey(process.env.GROQ_API_KEY)}` } });
        
        const content = JSON.parse(groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);

        // 2. الصوت والفيديو
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

        // 3. الدمج (FFmpeg)
        const finalPath = path.join(workDir, 'final.mp4');
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, ['-y', '-i', videoPath, '-i', audioPath, '-c:v', 'libx264', '-preset', 'ultrafast', '-shortest', finalPath]);
            ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(`FFmpeg Fail: ${code}`));
        });

        // 4. الرفع الحقيقي ليوتيوب
        console.log("⬆️ جاري الرفع الآن...");
        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: content.title, description: content.story + " #shorts", categoryId: "22" },
                status: { privacyStatus: 'public', selfDeclaredMadeForKids: false }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        res.send(`
            <div style="font-family:sans-serif; text-align:center; padding:50px;">
                <h1 style="color:#4CAF50;">🚀 تم النشر بنجاح!</h1>
                <p><strong>العنوان:</strong> ${content.title}</p>
                <a href="https://youtu.be/${uploadRes.data.id}" target="_blank" 
                   style="background:#ff0000; color:#fff; padding:15px 25px; text-decoration:none; border-radius:5px;">
                   مشاهدة الفيديو على يوتيوب
                </a>
            </div>
        `);

    } catch (error) {
        res.status(500).send(`❌ خطأ V10.0: ${error.message}`);
    } finally {
        fs.remove(workDir).catch(()=>{});
    }
});

app.listen(port, '0.0.0.0', () => console.log(`V10.0 Final Active`));
