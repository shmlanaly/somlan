const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const gTTS = require('gtts');
const { spawn, exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const app = express();
const port = process.env.PORT || 8080;

// دالة مساعدة لتنظيف المفاتيح
const cleanKey = (k) => k ? k.trim() : "";

// دالة متقدمة لاستخراج التوكن بأمان
const getTokens = () => {
    const raw = cleanKey(process.env.TOKENS);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return { refresh_token: raw }; }
};

// فحص وجود FFmpeg في النظام عند التشغيل
const checkFFmpeg = () => {
    return new Promise((resolve) => {
        exec('ffmpeg -version', (err, stdout, stderr) => {
            if (err) resolve(`❌ FFmpeg غير موجود: ${err.message}`);
            else resolve(`✅ FFmpeg مثبت: ${stdout.split('\n')[0]}`);
        });
    });
};

const GROQ_KEY = cleanKey(process.env.GROQ_API_KEY);
const PEXELS_KEY = cleanKey(process.env.PEXELS_API);

// إعداد يوتيوب
let youtube;
let youtubeStatus = "غير متصل";
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
        youtubeStatus = "✅ متصل (Tokens Found)";
    } else {
        youtubeStatus = "⚠️ تحذير: لا توجد TOKENS";
    }
} catch (error) { youtubeStatus = `❌ خطأ في الإعداد: ${error.message}`; }

app.get('/make-viral-video', async (req, res) => {
    // تمديد المهلة لمنع انقطاع الاتصال
    req.setTimeout(300000); // 5 دقائق

    // 1. تقرير الفحص الأولي (Diagnostic Report)
    const ffmpegStatus = await checkFFmpeg();
    console.log(`Diagnostic: [${ffmpegStatus}] | YouTube: [${youtubeStatus}]`);

    if (ffmpegStatus.includes('❌')) {
        return res.status(500).send(`🛑 خطأ جوهري في الاستضافة:\n${ffmpegStatus}\n\nالحل: تأكد من ملف nixpacks.toml`);
    }

    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);
    
    try {
        console.log("🚀 V9.2 Start Process...");

        // 2. Groq Generation
        console.log("...Generating Story");
        if (!GROQ_KEY) throw new Error("مفتاح GROQ مفقود");
        
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "قصة قصيرة جدا (15 كلمة) وعنوان عن التكنولوجيا بصيغة JSON: {\"title\": \"...\", \"story\": \"...\"}" }]
        }, { headers: { "Authorization": `Bearer ${GROQ_KEY}` } });

        let content;
        try { content = JSON.parse(groqRes.data.choices[0].message.content); }
        catch(e) { 
             // استخراج JSON بالقوة إذا كان النص مختلطاً
             const jsonMatch = groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/);
             content = jsonMatch ? JSON.parse(jsonMatch[0]) : { title: "Tech Fact", story: groqRes.data.choices[0].message.content };
        }

        // 3. Audio (gTTS)
        console.log("...Generating Audio");
        const audioPath = path.join(workDir, 'audio.mp3');
        await new Promise((resolve, reject) => {
            const gtts = new gTTS(content.story, 'ar');
            gtts.save(audioPath, (err) => err ? reject(new Error(`gTTS Failed: ${err}`)) : resolve());
        });

        // 4. Video (Pexels)
        console.log("...Fetching Video");
        if (!PEXELS_KEY) throw new Error("مفتاح Pexels مفقود");
        
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=technology&orientation=portrait&size=small&per_page=1`, {
            headers: { "Authorization": PEXELS_KEY }
        });
        
        if (!pexelsRes.data.videos || !pexelsRes.data.videos.length) throw new Error("Pexels لم يجد أي فيديو");
        
        const videoUrl = pexelsRes.data.videos[0].video_files[0].link;
        const videoPath = path.join(workDir, 'video.mp4');
        const writer = fs.createWriteStream(videoPath);
        const vidResponse = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        vidResponse.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', (e) => reject(new Error(`Video Download Failed: ${e.message}`)));
        });

        // 5. Merge (FFmpeg) - مع تسجيل دقيق للأخطاء
        console.log("...Merging with FFmpeg");
        const finalPath = path.join(workDir, 'final.mp4');
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-y', '-i', videoPath, '-i', audioPath,
                '-map', '0:v', '-map', '1:a',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-shortest',
                finalPath
            ]);
            
            let ffmpegLog = "";
            ffmpeg.stderr.on('data', (d) => ffmpegLog += d.toString());
            
            ffmpeg.on('error', (err) => reject(new Error(`FFmpeg Process Error: ${err.message}`)));
            ffmpeg.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`FFmpeg Exited Code ${code}. \nLOG: ${ffmpegLog.slice(-300)}`));
            });
        });

        // 6. Upload
        console.log("...Uploading to YouTube");
        if (!youtube) throw new Error("YouTube Client not initialized");
        
        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: content.title, description: content.story + " #shorts", tags: ["shorts"] },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        res.send(`
            <h1>✅ تم النشر بنجاح (V9.2)!</h1>
            <p><strong>العنوان:</strong> ${content.title}</p>
            <p><strong>حالة النظام:</strong> ${ffmpegStatus}</p>
            <p><a href="https://youtu.be/${uploadRes.data.id}" target="_blank">شاهد الفيديو على يوتيوب</a></p>
        `);

    } catch (error) {
        console.error("CRITICAL:", error);
        // تحويل الخطأ إلى نص مقروء مهما كان نوعه
        let errorText = "Unknown Error";
        if (error instanceof Error) errorText = error.message;
        else if (typeof error === 'object') errorText = JSON.stringify(error, null, 2);
        else errorText = String(error);

        res.status(500).send(`
            <h1>❌ تقرير الخطأ (V9.2)</h1>
            <pre style="background:#f4f4f4; padding:10px; border:1px solid #ccc;">${errorText}</pre>
            <h3>حالة النظام:</h3>
            <pre>${ffmpegStatus}</pre>
            <h3>حالة يوتيوب:</h3>
            <pre>${youtubeStatus}</pre>
        `);
    } finally {
        fs.remove(workDir).catch(()=>{});
    }
});

app.listen(port, '0.0.0.0', () => console.log(`Server V9.2 (Diagnostic Mode) Running on ${port}`));
