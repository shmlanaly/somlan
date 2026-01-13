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

// دالة لإدارة الذاكرة (منع التكرار)
const getHistory = () => {
    if (fs.existsSync(historyFile)) return fs.readJsonSync(historyFile);
    return [];
};
const saveToHistory = (title) => {
    const history = getHistory();
    history.push(title);
    if (history.length > 100) history.shift(); // احتفاظ بآخر 100 فيديو فقط
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

        // 1. طلب قصة رعب فريدة (مع إخبار الذكاء الاصطناعي بالقصص السابقة لتجنبها)
        console.log("👻 جاري تأليف قصة رعب جديدة...");
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ 
                role: "user", 
                content: `اكتب قصة رعب قصيرة جداً ومخيفة باللغة العربية (حوالي 100 كلمة). تأكد أنها ليست عن: ${history.join(', ')}. أرسل النتيجة JSON حصراً: {"title": "..", "story": "..", "search_term": "كلمة بحث بالانجليزية لفيلم مرعب"}` 
            }]
        }, { headers: { "Authorization": `Bearer ${cleanKey(process.env.GROQ_API_KEY)}` } });
        
        const content = JSON.parse(groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);
        
        // منع التكرار: إذا كانت القصة موجودة مسبقاً، نطلب غيرها (تبسيطاً سنعتمد على العنوان)
        if (history.includes(content.title)) return res.send("⚠️ هذه القصة تم نشرها من قبل، جرب مرة أخرى.");

        const audioPath = path.join(workDir, 'audio.mp3');
        const videoPath = path.join(workDir, 'video.mp4');
        const finalPath = path.join(workDir, 'final.mp4');
        
        await new Promise((resolve) => new gTTS(content.story, 'ar').save(audioPath, resolve));
        
        // 2. البحث عن فيديو رعب عشوائي (غير مكرر)
        console.log("📹 جاري البحث عن مقطع مرعب مناسب...");
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=${content.search_term || "horror"}&orientation=portrait&per_page=15`, { 
            headers: { "Authorization": cleanKey(process.env.PEXELS_API) } 
        });
        
        // اختيار فيديو عشوائي من النتائج الـ 15 لضمان عدم التكرار
        const randomVid = pexelsRes.data.videos[Math.floor(Math.random() * pexelsRes.data.videos.length)];
        const videoUrl = randomVid.video_files.find(f => f.width < 1000).link;
        
        const writer = fs.createWriteStream(videoPath);
        const vid = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        vid.data.pipe(writer);
        await new Promise((res) => writer.on('finish', res));

        // 3. المونتاج بنمط الرعب (إضاءة خافتة + نص)
        console.log("⚙️ جاري المونتاج...");
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, [
                '-y', '-stream_loop', '-1', '-i', videoPath, '-i', audioPath,
                '-filter_complex', `[1:a]atempo=0.9[outa];[0:v]eq=brightness=-0.1:contrast=1.2,drawtext=text='${content.title}':fontcolor=red:fontsize=50:x=(w-text_w)/2:y=150:box=1:boxcolor=black@0.7[outv]`,
                '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'ultrafast', '-shortest', 
                '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280', finalPath
            ]);
            ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(new Error("FFmpeg Error")));
        });

        // 4. الرفع وتحديث الذاكرة
        console.log("⬆️ جاري الرفع إلى يوتيوب...");
        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: content.title + " #shorts #horror", description: content.story + "\n\n#رعب #قصص_مخيفة", categoryId: "24" },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        saveToHistory(content.title); // حفظ في الذاكرة لمنع التكرار مستقبلاً
        res.send(`<h1>✅ تم نشر قصة رعب جديدة!</h1><p>الرابط: https://youtu.be/${uploadRes.data.id}</p>`);

    } catch (error) {
        res.status(500).send(`❌ خطأ مصنع الرعب: ${error.message}`);
    } finally { fs.remove(workDir).catch(()=>{}); }
});

app.listen(port, '0.0.0.0', () => console.log(`Horror Factory V17 Active`));
