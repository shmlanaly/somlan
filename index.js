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

// تهيئة يوتيوب مع حماية من الأخطاء
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
    } catch (e) { throw new Error("يوتيوب: الرموز (Tokens) غير صالحة"); }
};

app.get('/make-viral-video', async (req, res) => {
    req.setTimeout(600000); 
    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);
    
    try {
        console.log("🚀 V11.0: بدء الإنتاج بنمط استهلاك الموارد المنخفض...");
        const youtube = getYoutubeClient();

        // 1. محتوى ذكي وقصير جداً لتقليل حجم الفيديو
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "اعطني حقيقة مذهلة في 10 كلمات فقط بصيغة JSON: {\"title\": \"..\", \"story\": \"..\"}" }]
        }, { headers: { "Authorization": `Bearer ${cleanKey(process.env.GROQ_API_KEY)}` } });
        
        const content = JSON.parse(groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);

        const audioPath = path.join(workDir, 'audio.mp3');
        const videoPath = path.join(workDir, 'video.mp4');
        
        await Promise.all([
            new Promise((res, rej) => new gTTS(content.story, 'ar').save(audioPath, (e) => e ? rej(e) : res())),
            (async () => {
                // طلب أصغر جودة ممكنة من Pexels لتوفير الذاكرة
                const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=nature&orientation=portrait&per_page=1&size=small`, { 
                    headers: { "Authorization": cleanKey(process.env.PEXELS_API) } 
                });
                const writer = fs.createWriteStream(videoPath);
                const vid = await axios({ url: pexelsRes.data.videos[0].video_files[0].link, method: 'GET', responseType: 'stream' });
                vid.data.pipe(writer);
                return new Promise((res) => writer.on('finish', res));
            })()
        ]);

        // 2. الدمج الحذر (The Cautious Merge)
        const finalPath = path.join(workDir, 'final.mp4');
        console.log("⚙️ جاري الدمج بنمط الحماية من الانهيار...");
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, [
                '-y', 
                '-i', videoPath, 
                '-i', audioPath,
                '-t', '15',                 // تحديد مدة الفيديو بـ 15 ثانية كحد أقصى
                '-vf', 'scale=480:-1',      // تقليل الدقة لـ 480p لتقليل ضغط الرام
                '-c:v', 'libx264', 
                '-preset', 'ultrafast',     // أسرع معالجة ممكنة
                '-crf', '28',               // تقليل الجودة قليلاً لتخفيف الملف
                '-threads', '1',            // إجبار المعالج على استخدام نواة واحدة فقط لمنع قتله
                '-shortest', 
                finalPath
            ]);

            ffmpeg.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`FFmpeg تم إنهاؤه بالكود: ${code}`));
            });
            
            ffmpeg.on('error', (err) => reject(new Error(`فشل بدء FFmpeg: ${err.message}`)));
        });

        // 3. الرفع السريع
        console.log("⬆️ جاري الرفع النهائي...");
        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: content.title, description: content.story + " #shorts" },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        res.send(`<h1>✅ تم النشر بنجاح!</h1><p>الرابط: https://youtu.be/${uploadRes.data.id}</p>`);

    } catch (error) {
        console.error("V11 Error:", error.message);
        res.status(500).send(`❌ خطأ V11 حاسم: ${error.message}`);
    } finally {
        fs.remove(workDir).catch(()=>{});
    }
});

app.listen(port, '0.0.0.0', () => console.log(`Architecture V11.0 Stable Ready`));
