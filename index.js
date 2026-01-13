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
        console.log("🚀 V13.0: إنتاج فيديو احترافي...");
        const youtube = getYoutubeClient();

        // 1. طلب قصة أطول قليلاً (حوالي 30-40 كلمة) لضمان وقت كافٍ
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "اعطني حقيقة مذهلة وطويلة (40 كلمة) بصيغة JSON: {\"title\": \"..\", \"story\": \"..\"}" }]
        }, { headers: { "Authorization": `Bearer ${cleanKey(process.env.GROQ_API_KEY)}` } });
        
        const content = JSON.parse(groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);

        const audioPath = path.join(workDir, 'audio.mp3');
        const videoPath = path.join(workDir, 'video.mp4');
        
        // توليد الصوت
        await new Promise((res, rej) => {
            const gtts = new gTTS(content.story, 'ar');
            gtts.save(audioPath, (e) => e ? rej(e) : res());
        });

        // 2. البحث عن فيديو عالي الجودة وطويل (Portrait)
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=nature&orientation=portrait&per_page=5`, { 
            headers: { "Authorization": cleanKey(process.env.PEXELS_API) } 
        });
        
        // نختار الفيديو الثاني أو الثالث لضمان التنوع
        const videoUrl = pexelsRes.data.videos[0].video_files.find(f => f.quality === 'sd' || f.width < 1000).link;
        const writer = fs.createWriteStream(videoPath);
        const vid = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        vid.data.pipe(writer);
        await new Promise((res) => writer.on('finish', res));

        // 3. الدمج الاحترافي (إعادة تكرار الفيديو ليناسب الصوت)
        const finalPath = path.join(workDir, 'final.mp4');
        console.log("⚙️ جاري دمج الفيديو مع الصوت مع ميزة Loop...");
        
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, [
                '-y', 
                '-stream_loop', '-1', // تكرار الفيديو للأبد حتى ينتهي الصوت
                '-i', videoPath, 
                '-i', audioPath,
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-crf', '28',
                '-c:a', 'aac',
                '-map', '0:v:0',
                '-map', '1:a:0',
                '-shortest', // التوقف عند انتهاء أقصر ملف (وهو الصوت هنا بعد الـ loop)
                '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280', // إجبار أبعاد الـ Shorts
                finalPath
            ]);

            ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(new Error("FFmpeg Fail")));
        });

        // 4. الرفع بعنوان جذاب لضمان ظهور الـ Shorts
        console.log("⬆️ الرفع النهائي كـ Shorts...");
        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { 
                    title: content.title + " #shorts", 
                    description: content.story + "\n\n#shorts #facts #technology",
                    categoryId: "22"
                },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        res.send(`<h1>✅ تم النشر باحترافية (V13)!</h1><p>رابط الفيديو الطويل/Shorts: https://youtu.be/${uploadRes.data.id}</p>`);

    } catch (error) {
        res.status(500).send(`❌ خطأ الجودة V13: ${error.message}`);
    } finally {
        fs.remove(workDir).catch(()=>{});
    }
});

app.listen(port, '0.0.0.0', () => console.log(`Professional V13 Active`));
