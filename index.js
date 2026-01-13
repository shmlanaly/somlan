const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const gTTS = require('gtts');
const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const app = express();
const port = process.env.PORT || 8080;

// التأكد من أن المفاتيح موجودة
const checkKeys = () => {
    if (!process.env.CLIENT_ID) return "❌ خطأ: CLIENT_ID مفقود في متغيرات Railway";
    if (!process.env.GROQ_API_KEY) return "❌ خطأ: GROQ_API_KEY مفقود";
    if (!process.env.PEXELS_API) return "❌ خطأ: PEXELS_API مفقود";
    return "✅ المفاتيح موجودة";
};

const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
);
oauth2Client.setCredentials({ refresh_token: process.env.TOKENS });

app.get('/make-viral-video', async (req, res) => {
    const timeNow = new Date().toISOString();
    console.log(`بدء محاولة جديدة: ${timeNow}`);
    
    // فحص أولي
    const keyStatus = checkKeys();
    if (keyStatus.includes("❌")) return res.send(keyStatus);

    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);

    try {
        // 1. Groq
        console.log("جاري الاتصال بـ Groq...");
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "اعطني عنواناً مضحكاً جداً وقصة قصيرة جداً عن قطة بصيغة JSON: {'title': '...', 'story': '...'}" }]
        }, { headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}` } });
        
        let content;
        try {
            content = JSON.parse(groqRes.data.choices[0].message.content);
        } catch (e) {
            content = { title: "عنوان احتياطي", story: groqRes.data.choices[0].message.content };
        }

        // 2. Pexels
        console.log("جاري الاتصال بـ Pexels...");
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=cat&per_page=1&page=${Math.floor(Math.random() * 50) + 1}`, {
            headers: { "Authorization": process.env.PEXELS_API }
        });
        if (!pexelsRes.data.videos.length) throw new Error("Pexels لم يجد فيديو");
        const videoUrl = pexelsRes.data.videos[0].video_files[0].link;

        // 3. المعالجة السريعة
        const audioPath = path.join(workDir, 'voice.mp3');
        await new Promise(r => new gTTS(content.story, 'ar').save(audioPath, r));
        
        const videoPath = path.join(workDir, 'raw.mp4');
        const vWriter = fs.createWriteStream(videoPath);
        const response = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        response.data.pipe(vWriter);
        await new Promise(r => vWriter.on('finish', r));

        const finalPath = path.join(workDir, 'output.mp4');
        // أمر دمج بسيط جداً لتجنب الأخطاء
        await new Promise((resolve, reject) => {
            exec(`ffmpeg -i ${videoPath} -i ${audioPath} -t 5 -c:v libx264 -c:a aac -map 0:v:0 -map 1:a:0 ${finalPath}`, (err) => {
                if (err) reject(err); else resolve();
            });
        });

        // 4. الرفع
        const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
        await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: `${content.title} - ${Date.now()}`, description: "Test", categoryId: '15' },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        res.send(`✅ نجح التحديث الجديد! العنوان: ${content.title} \n الوقت: ${timeNow}`);

    } catch (err) {
        // هنا السر: سنعرض الخطأ في المتصفح بدلاً من إخفائه
        console.error(err);
        res.send(`⚠️ تم كشف الخطأ في التحديث الجديد: \n ${err.message} \n ${err.response ? JSON.stringify(err.response.data) : ''}`);
    } finally {
        fs.remove(workDir);
    }
});

app.listen(port, '0.0.0.0', () => console.log(`Server V6.0 running on ${port}`));
