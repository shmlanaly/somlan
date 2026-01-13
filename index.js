const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const gTTS = require('gtts');
const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const app = express();
const port = process.env.PORT || 8080;

// دوال التنظيف
const cleanKey = (k) => k ? k.trim() : "";

// إصلاح ذكي للتوكن (يقبل النص أو JSON)
const getTokens = () => {
    const raw = cleanKey(process.env.TOKENS);
    if (!raw) return null;
    try {
        return JSON.parse(raw); // محاولة قراءته كملف
    } catch (e) {
        return { refresh_token: raw }; // إذا فشل، نعتبره توكن مباشر
    }
};

const GROQ_KEY = cleanKey(process.env.GROQ_API_KEY);
const PEXELS_KEY = cleanKey(process.env.PEXELS_API);

// إعداد يوتيوب الآمن (لن يتعطل إذا كان التوكن فارغاً)
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
        console.log("✅ تم ربط يوتيوب بنجاح.");
    } else {
        console.log("⚠️ تحذير: لم يتم العثور على TOKENS");
    }
} catch (error) {
    console.error("❌ خطأ في إعداد يوتيوب:", error.message);
}

app.get('/make-viral-video', async (req, res) => {
    if (!youtube) return res.send("❌ السيرفر يعمل، لكن إعدادات يوتيوب (TOKENS) غير صحيحة.");
    
    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);
    
    try {
        console.log("🚀 بدء صناعة الفيديو V8.1...");

        // 1. القصة
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ 
                role: "user", 
                content: "أكتب لي قصة قصيرة جداً (30 كلمة) وعنوان جذاب عن حقيقة علمية غريبة بصيغة JSON حصراً: {\"title\": \"...\", \"story\": \"...\"}" 
            }]
        }, { headers: { "Authorization": `Bearer ${GROQ_KEY}` } });

        let content;
        try {
            content = JSON.parse(groqRes.data.choices[0].message.content);
        } catch(e) {
            const jsonMatch = groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/);
            content = jsonMatch ? JSON.parse(jsonMatch[0]) : { title: "حقيقة مدهشة", story: groqRes.data.choices[0].message.content };
        }

        // 2. الصوت
        const audioPath = path.join(workDir, 'audio.mp3');
        await new Promise((resolve, reject) => {
            const gtts = new gTTS(content.story, 'ar');
            gtts.save(audioPath, (err) => err ? reject(err) : resolve());
        });

        // 3. الفيديو
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=nature&orientation=portrait&per_page=1`, {
            headers: { "Authorization": PEXELS_KEY }
        });
        const videoUrl = pexelsRes.data.videos[0].video_files[0].link;
        const videoPath = path.join(workDir, 'video.mp4');
        const writer = fs.createWriteStream(videoPath);
        const vidResponse = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        vidResponse.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        // 4. الدمج
        const finalPath = path.join(workDir, 'final.mp4');
        console.log("⚙️ جاري الدمج...");
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-y', '-i', videoPath, '-i', audioPath,
                '-map', '0:v', '-map', '1:a',
                '-c:v', 'copy', '-shortest',
                finalPath
            ]);
            ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(`FFmpeg error code: ${code}`));
        });

        // 5. الرفع
        console.log("⬆️ جاري الرفع...");
        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: content.title, description: content.story + "\n#shorts", tags: ["shorts"] },
                status: { privacyStatus: 'public', selfDeclaredMadeForKids: false }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        res.send(`✅ تم النشر بنجاح (V8.1)! \n 🎬 الفيديو: https://youtu.be/${uploadRes.data.id}`);

    } catch (error) {
        console.error(error);
        res.send(`❌ حدث خطأ: ${error.message}`);
    } finally {
        fs.remove(workDir);
    }
});

app.listen(port, '0.0.0.0', () => console.log(`Factory V8.1 Running on ${port}`));
