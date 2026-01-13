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
} catch (error) { console.error("YouTube Setup Error:", error); }

app.get('/make-viral-video', async (req, res) => {
    req.setTimeout(300000); 
    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);
    
    try {
        console.log("🚀 V9.1 Start...");
        if (!youtube) throw new Error("مشكلة في إعدادات يوتيوب (الرموز غير صحيحة)");

        // 1. Groq
        console.log("1. Groq...");
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "عنوان وقصة قصيرة جدا (15 كلمة) عن الفضاء بصيغة JSON: {\"title\": \"...\", \"story\": \"...\"}" }]
        }, { headers: { "Authorization": `Bearer ${GROQ_KEY}` } });

        let content;
        try { content = JSON.parse(groqRes.data.choices[0].message.content); }
        catch(e) { 
             const jsonMatch = groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/);
             content = jsonMatch ? JSON.parse(jsonMatch[0]) : { title: "فضاء", story: groqRes.data.choices[0].message.content };
        }

        // 2. Audio
        console.log("2. Audio...");
        const audioPath = path.join(workDir, 'audio.mp3');
        await new Promise((resolve, reject) => {
            const gtts = new gTTS(content.story, 'ar');
            gtts.save(audioPath, (err) => err ? reject(new Error("gTTS Error: " + err)) : resolve());
        });

        // 3. Video
        console.log("3. Pexels...");
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=space&orientation=portrait&size=small&per_page=1`, {
            headers: { "Authorization": PEXELS_KEY }
        });
        if (!pexelsRes.data.videos.length) throw new Error("Pexels: لا يوجد فيديو");
        const videoUrl = pexelsRes.data.videos[0].video_files[0].link;
        const videoPath = path.join(workDir, 'video.mp4');
        const writer = fs.createWriteStream(videoPath);
        const vidResponse = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        vidResponse.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', (err) => reject(new Error("Video Download Error: " + err)));
        });

        // 4. Merge (FFmpeg Debug)
        console.log("4. Merging...");
        const finalPath = path.join(workDir, 'final.mp4');
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-y', '-i', videoPath, '-i', audioPath,
                '-map', '0:v', '-map', '1:a',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-shortest',
                finalPath
            ]);
            
            let errorLog = "";
            ffmpeg.stderr.on('data', (d) => errorLog += d.toString());
            
            ffmpeg.on('error', (err) => reject(new Error("FFmpeg فشل في البدء: " + err.message)));
            ffmpeg.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`FFmpeg exited with code ${code}. Log: ${errorLog.slice(-200)}`)); // عرض آخر 200 حرف من الخطأ
            });
        });

        // 5. Upload
        console.log("5. Uploading...");
        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: content.title, description: content.story + " #shorts", tags: ["shorts"] },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        res.send(`✅ تم النشر (V9.1)! الرابط: https://youtu.be/${uploadRes.data.id}`);

    } catch (error) {
        console.error("FINAL ERROR:", error);
        // إصلاح الخطأ السابق: عرض الخطأ سواء كان كائناً أو نصاً
        const msg = error.message || error.toString() || "خطأ مجهول";
        res.status(500).send(`❌ السبب الحقيقي للخطأ: \n ${msg}`);
    } finally {
        fs.remove(workDir).catch(()=>{});
    }
});

app.listen(port, '0.0.0.0', () => console.log(`Server V9.1 Debugger running on ${port}`));
