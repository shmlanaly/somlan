const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const gTTS = require('gtts');
const { spawn } = require('child_process');
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
        console.log("✅ YouTube Linked");
    }
} catch (error) { console.error("YouTube Error:", error.message); }

app.get('/make-viral-video', async (req, res) => {
    // زيادة وقت المهلة لضمان عدم انقطاع الاتصال
    req.setTimeout(300000); // 5 دقائق

    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);
    
    try {
        console.log("🚀 V9.0 Start...");
        if (!youtube) throw new Error("إعدادات يوتيوب غير صحيحة (TOKENS)");

        // 1. القصة
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "قصة قصيرة جداً (20 كلمة) وعنوان عن حقيقة علمية بصيغة JSON: {\"title\": \"...\", \"story\": \"...\"}" }]
        }, { headers: { "Authorization": `Bearer ${GROQ_KEY}` } });

        let content;
        try { content = JSON.parse(groqRes.data.choices[0].message.content); }
        catch(e) { 
            const jsonMatch = groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/);
            content = jsonMatch ? JSON.parse(jsonMatch[0]) : { title: "Fact", story: groqRes.data.choices[0].message.content };
        }

        // 2. الصوت
        const audioPath = path.join(workDir, 'audio.mp3');
        await new Promise((resolve, reject) => {
            const gtts = new gTTS(content.story, 'ar');
            gtts.save(audioPath, (err) => err ? reject(err) : resolve());
        });

        // 3. الفيديو (جودة أقل لسرعة المعالجة)
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=nature&orientation=portrait&size=small&per_page=1`, {
            headers: { "Authorization": PEXELS_KEY }
        });
        if (!pexelsRes.data.videos.length) throw new Error("لم يتم العثور على فيديو في Pexels");
        
        const videoUrl = pexelsRes.data.videos[0].video_files[0].link;
        const videoPath = path.join(workDir, 'video.mp4');
        const writer = fs.createWriteStream(videoPath);
        const vidResponse = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        vidResponse.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        // 4. الدمج (مع حماية من الانهيار)
        const finalPath = path.join(workDir, 'final.mp4');
        console.log("⚙️ Merging...");
        await new Promise((resolve, reject) => {
            // استخدام إعدادات خفيفة جداً (ultrafast) لمنع تعليق السيرفر
            const ffmpeg = spawn('ffmpeg', [
                '-y', '-i', videoPath, '-i', audioPath,
                '-map', '0:v', '-map', '1:a',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-shortest', // تسريع الدمج
                finalPath
            ]);
            
            // 🔥 هذا هو الإصلاح: التقاط أخطاء التشغيل
            ffmpeg.on('error', (err) => reject(`FFmpeg Failed to start: ${err.message}`));
            ffmpeg.stderr.on('data', (data) => console.log(`FFmpeg: ${data}`)); // مراقبة السجل
            ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(`FFmpeg exited with code ${code}`));
        });

        // 5. الرفع
        console.log("⬆️ Uploading...");
        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: content.title, description: content.story + " #shorts", tags: ["shorts"] },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        res.send(`✅ تم (V9.0)! الفيديو: https://youtu.be/${uploadRes.data.id}`);

    } catch (error) {
        console.error("CRITICAL ERROR:", error);
        res.status(500).send(`❌ خطأ بالتفصيل: ${error.message}`);
    } finally {
        fs.remove(workDir).catch(() => {});
    }
});

app.listen(port, '0.0.0.0', () => console.log(`Server V9.0 Stable running on ${port}`));
