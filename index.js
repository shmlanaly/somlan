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
    if (fs.existsSync(historyFile)) return fs.readJsonSync(historyFile);
    return [];
};
const saveToHistory = (title) => {
    const history = getHistory();
    history.push(title);
    if (history.length > 50) history.shift();
    fs.writeJsonSync(historyFile, history);
};

const getYoutubeClient = () => {
    try {
        const rawTokens = cleanKey(process.env.TOKENS);
        const tokens = rawTokens.startsWith('{') ? JSON.parse(rawTokens) : { refresh_token: rawTokens };
        const oauth2Client = new google.auth.OAuth2(cleanKey(process.env.CLIENT_ID), cleanKey(process.env.CLIENT_SECRET), "https://developers.google.com/oauthplayground");
        oauth2Client.setCredentials(tokens);
        return google.youtube({ version: 'v3', auth: oauth2Client });
    } catch (e) { throw new Error("يوتيوب: فشل الإعداد"); }
};

app.get('/make-viral-video', async (req, res) => {
    req.setTimeout(900000); 
    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);
    
    try {
        const youtube = getYoutubeClient();
        const history = getHistory();

        console.log("👻 جاري تأليف قصة رعب فريدة...");
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ 
                role: "user", 
                content: `اكتب قصة رعب قصيرة ومخيفة جداً بالعربي (80-90 كلمة). لا تكرر هذه المواضيع: ${history.join(', ')}. أرسل النتيجة JSON: {"title": "..", "story": "..", "search_term": "horror dark"}` 
            }]
        }, { headers: { "Authorization": `Bearer ${cleanKey(process.env.GROQ_API_KEY)}` } });
        
        const content = JSON.parse(groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);
        
        const audioPath = path.join(workDir, 'audio.mp3');
        const videoPath = path.join(workDir, 'video.mp4');
        const finalPath = path.join(workDir, 'final.mp4');
        
        await new Promise((res, rej) => new gTTS(content.story, 'ar').save(audioPath, (err) => err ? rej(err) : res()));
        
        console.log("📹 جاري جلب فيديو عشوائي...");
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=${content.search_term || "horror"}&orientation=portrait&per_page=10`, { 
            headers: { "Authorization": cleanKey(process.env.PEXELS_API) } 
        });
        
        const vids = pexelsRes.data.videos;
        if (!vids || vids.length === 0) throw new Error("لم يتم العثور على فيديوهات في Pexels");
        const randomVid = vids[Math.floor(Math.random() * vids.length)];
        const videoUrl = randomVid.video_files.find(f => f.width < 1000).link;
        
        const writer = fs.createWriteStream(videoPath);
        const vidResponse = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        vidResponse.data.pipe(writer);
        await new Promise((res) => writer.on('finish', res));

        console.log("⚙️ جاري المونتاج المستقر V18...");
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, [
                '-y', '-stream_loop', '-1', '-i', videoPath, '-i', audioPath,
                '-vf', `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,drawtext=text='${content.title}':fontcolor=red:fontsize=40:x=(w-text_w)/2:y=150:box=1:boxcolor=black@0.6`,
                '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-threads', '1',
                '-c:a', 'aac', '-shortest', finalPath
            ]);

            let errorLog = "";
            ffmpeg.stderr.on('data', (data) => errorLog += data.toString());
            ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg Failed Code ${code}: ${errorLog.slice(-100)}`)));
        });

        console.log("⬆️ الرفع النهائي...");
        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: content.title + " #shorts #horror", description: content.story + "\n\n#رعب", categoryId: "24" },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        saveToHistory(content.title);
        res.send(`✅ تم بنجاح V18! الفيديو: https://youtu.be/${uploadRes.data.id}`);

    } catch (error) {
        console.error(error);
        res.status(500).send(`❌ خطأ V18: ${error.message}`);
    } finally { fs.remove(workDir).catch(()=>{}); }
});

app.listen(port, '0.0.0.0', () => console.log(`Stable Horror Factory V18 Ready`));
