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
    } catch (e) { throw new Error("يوتيوب: خطأ في الرموز"); }
};

app.get('/make-viral-video', async (req, res) => {
    req.setTimeout(600000); 
    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);
    
    try {
        console.log("🚀 V12.0: تشغيل بروتوكول النسخ المباشر...");
        const youtube = getYoutubeClient();

        // 1. محتوى سريع
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "حقيقة واحدة مذهلة (10 كلمات) JSON: {\"title\": \"..\", \"story\": \"..\"}" }]
        }, { headers: { "Authorization": `Bearer ${cleanKey(process.env.GROQ_API_KEY)}` } });
        
        const content = JSON.parse(groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);

        const audioPath = path.join(workDir, 'audio.mp3');
        const videoPath = path.join(workDir, 'video.mp4');
        
        await Promise.all([
            new Promise((res, rej) => new gTTS(content.story, 'ar').save(audioPath, (e) => e ? rej(e) : res())),
            (async () => {
                const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=nature&per_page=1&size=small`, { 
                    headers: { "Authorization": cleanKey(process.env.PEXELS_API) } 
                });
                const writer = fs.createWriteStream(videoPath);
                const vid = await axios({ url: pexelsRes.data.videos[0].video_files[0].link, method: 'GET', responseType: 'stream' });
                vid.data.pipe(writer);
                return new Promise((res) => writer.on('finish', res));
            })()
        ]);

        // 2. الدمج الذكي (Stream Copy)
        // نستخدم -c:v copy لنقل الفيديو كما هو دون ضغط (CPU = 0)
        // نستخدم -c:a aac لتحويل الصوت فقط لأنه خفيف جداً
        const finalPath = path.join(workDir, 'final.mp4');
        console.log("⚙️ جاري دمج المسارات بدون إعادة ترميز...");
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, [
                '-y', 
                '-i', videoPath, 
                '-i', audioPath,
                '-c:v', 'copy',      // 🔥 السر هنا: نسخ الفيديو وليس إعادة معالجته
                '-c:a', 'aac',       // تحويل الصوت لصيغة متوافقة
                '-map', '0:v:0',     // خذ الفيديو من الملف الأول
                '-map', '1:a:0',     // خذ الصوت من الملف الثاني
                '-shortest', 
                finalPath
            ]);

            let log = "";
            ffmpeg.stderr.on('data', (d) => log += d.toString());
            ffmpeg.on('close', (code) => {
                if (code === 0) resolve();
                else {
                    console.log("Copy failed, trying Fallback...");
                    // إذا فشل النسخ المباشر، نجرب مشفر mpeg4 البدائي جداً
                    const fallback = spawn(ffmpegPath, [
                        '-y', '-i', videoPath, '-i', audioPath,
                        '-c:v', 'mpeg4', '-preset', 'ultrafast', '-shortest', finalPath
                    ]);
                    fallback.on('close', (c) => c === 0 ? resolve() : reject(new Error(`Failed with Log: ${log.slice(-100)}`)));
                }
            });
        });

        // 3. الرفع
        console.log("⬆️ الرفع النهائي...");
        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: content.title, description: content.story + " #shorts" },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        res.send(`<h1>✅ مبروك! تم الكسر والرفع بنجاح (V12)</h1><p>الرابط: https://youtu.be/${uploadRes.data.id}</p>`);

    } catch (error) {
        res.status(500).send(`❌ خطأ V12 النهائي: ${error.message}`);
    } finally {
        fs.remove(workDir).catch(()=>{});
    }
});

app.listen(port, '0.0.0.0', () => console.log(`Stable V12.0 Ready`));
