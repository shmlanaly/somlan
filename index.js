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
const historyFile = path.join(__dirname, 'history.json');

const getHistory = () => {
    try { return fs.existsSync(historyFile) ? fs.readJsonSync(historyFile) : []; } 
    catch (e) { return []; }
};
const saveToHistory = (title) => {
    try {
        const history = getHistory();
        history.push(title);
        if (history.length > 50) history.shift();
        fs.writeJsonSync(historyFile, history);
    } catch (e) { console.error("History Save Error"); }
};

const getYoutubeClient = () => {
    try {
        const rawTokens = cleanKey(process.env.TOKENS);
        const tokens = rawTokens.startsWith('{') ? JSON.parse(rawTokens) : { refresh_token: rawTokens };
        const oauth2Client = new google.auth.OAuth2(cleanKey(process.env.CLIENT_ID), cleanKey(process.env.CLIENT_SECRET), "https://developers.google.com/oauthplayground");
        oauth2Client.setCredentials(tokens);
        return google.youtube({ version: 'v3', auth: oauth2Client });
    } catch (e) { throw new Error("يوتيوب: إعدادات خاطئة"); }
};

app.get('/make-viral-video', async (req, res) => {
    req.setTimeout(900000); 
    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);
    
    try {
        const youtube = getYoutubeClient();
        const history = getHistory();

        console.log("👻 جاري تأليف قصة رعب طويلة...");
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ 
                role: "user", 
                content: `اكتب قصة رعب حقيقية ومخيفة جداً بالعربي. يجب أن يكون النص طويلاً (حوالي 120 كلمة) لضمان مدة فيديو أكثر من 35 ثانية. لا تكرر: ${history.join(', ')}. أرسل JSON حصراً: {"title": "..", "story": ".."}` 
            }]
        }, { headers: { "Authorization": `Bearer ${cleanKey(process.env.GROQ_API_KEY)}` } });
        
        const content = JSON.parse(groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);
        
        const audioPath = path.join(workDir, 'audio.mp3');
        const videoPath = path.join(workDir, 'video.mp4');
        const finalPath = path.join(workDir, 'final.mp4');
        
        // توليد الصوت بسرعة طبيعية (Normal Speed)
        await new Promise((resolve, reject) => {
            const gtts = new gTTS(content.story, 'ar');
            gtts.save(audioPath, (err) => err ? reject(err) : resolve());
        });
        
        console.log("📹 جاري جلب فيديو مرعب عشوائي...");
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=scary horror&orientation=portrait&per_page=15`, { 
            headers: { "Authorization": cleanKey(process.env.PEXELS_API) } 
        });
        
        const randomVid = pexelsRes.data.videos[Math.floor(Math.random() * pexelsRes.data.videos.length)];
        const videoUrl = randomVid.video_files.find(f => f.width < 1000).link;
        
        const writer = fs.createWriteStream(videoPath);
        const vidResponse = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        vidResponse.data.pipe(writer);
        await new Promise((res) => writer.on('finish', res));

        console.log("⚙️ جاري دمج الفيديو بنمط الثبات V19...");
        await new Promise((resolve, reject) => {
            // استخدام أبسط الأوامر لضمان عدم حدوث خطأ Filter
            const ffmpeg = spawn(ffmpegPath, [
                '-y', 
                '-stream_loop', '-1', 
                '-i', videoPath, 
                '-i', audioPath,
                '-c:v', 'libx264', 
                '-preset', 'ultrafast', 
                '-crf', '28',
                '-c:a', 'aac', 
                '-map', '0:v:0', 
                '-map', '1:a:0', 
                '-shortest',
                '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
                finalPath
            ]);

            ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg Exit Code ${code}`)));
        });

        console.log("⬆️ جاري الرفع...");
        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: content.title + " #shorts #horror", description: content.story + "\n\n#رعب #قصص", categoryId: "24" },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        saveToHistory(content.title);
        res.send(`✅ تم النشر بنجاح V19! الصوت طبيعي والفيديو طويل: https://youtu.be/${uploadRes.data.id}`);

    } catch (error) {
        console.error(error);
        res.status(500).send(`❌ خطأ V19: ${error.message}`);
    } finally { fs.remove(workDir).catch(()=>{}); }
});

app.listen(port, '0.0.0.0', () => console.log(`Stable Horror Factory V19 Ready`));
