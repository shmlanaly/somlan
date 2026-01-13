const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const gTTS = require('gtts');
const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const app = express();
const port = process.env.PORT || 8080;

const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
);
oauth2Client.setCredentials({ refresh_token: process.env.TOKENS });

app.get('/make-viral-video', async (req, res) => {
    // 1. منع المتصفح من حفظ النتيجة القديمة (Cache-Control)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const uniqueID = Date.now(); // رقم فريد لا يتكرر أبداً
    console.log(`🔥 إصدار جديد V4.0 - عملية رقم: ${uniqueID}`);
    const workDir = path.join(__dirname, `temp_${uniqueID}`);
    await fs.ensureDir(workDir);

    try {
        // 2. اختيار صفحة عشوائية ومصطلح عشوائي
        const searchTerms = ['funny cat', 'cute kitten', 'cat playing', 'cat fails', 'funny animals'];
        const randomTerm = searchTerms[Math.floor(Math.random() * searchTerms.length)];
        const randomPage = Math.floor(Math.random() * 50) + 1;

        console.log(`🔍 بحث جديد عن: ${randomTerm} صفحة ${randomPage}`);

        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=${randomTerm}&per_page=1&page=${randomPage}&orientation=portrait`, {
            headers: { "Authorization": process.env.PEXELS_API }
        });

        if (!pexelsRes.data.videos || pexelsRes.data.videos.length === 0) throw new Error("لم يتم العثور على فيديو، جاري المحاولة مرة أخرى...");
        const videoUrl = pexelsRes.data.videos[0].video_files[0].link;

        // 3. قصة جديدة وعنوان جديد (مع رقم عشوائي لضمان الاختلاف)
        const titles = ["شوف حصل إيه! 😱", "موقف يموت ضحك 😂", "القطة دي مصيبة 🤣", "أذكى قطة في العالم 😎"];
        const randomTitle = titles[Math.floor(Math.random() * titles.length)] + ` #${Math.floor(Math.random() * 1000)}`;
        
        console.log("🤖 Groq يكتب القصة...");
        // استخدام عنوان عشوائي احتياطي في حال فشل الذكاء الاصطناعي
        let content = { title: randomTitle, story: "شوفوا الموقف المضحك ده مع ألطف كائنات!" };
        
        try {
            const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                model: "llama-3.3-70b-versatile",
                messages: [{ 
                    role: "user", 
                    content: `الوقت ${uniqueID}. اكتب JSON: {"title": "عنوان يوتيوب جذاب جدا", "story": "قصة قصيرة مضحكة جدا عن قطة"}` 
                }]
            }, { headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}` } });
            content = JSON.parse(groqRes.data.choices[0].message.content);
        } catch (e) { console.log("⚠️ استخدام العنوان الاحتياطي"); }

        // 4. المعالجة
        const audioPath = path.join(workDir, 'voice.mp3');
        await new Promise((resolve) => new gTTS(content.story, 'ar').save(audioPath, resolve));

        const videoPath = path.join(workDir, 'raw.mp4');
        const vWriter = fs.createWriteStream(videoPath);
        const vResponse = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        vResponse.data.pipe(vWriter);
        await new Promise((resolve) => vWriter.on('finish', resolve));

        const finalPath = path.join(workDir, 'final.mp4');
        
        // 5. تغيير الألوان قليلاً لخداع خوارزميات التكرار
        await new Promise((resolve, reject) => {
            exec(`ffmpeg -i ${videoPath} -i ${audioPath} -t 10 -vf "eq=gamma=${0.9 + Math.random()*0.2}" -c:v libx264 -c:a aac -map 0:v:0 -map 1:a:0 ${finalPath}`, (err) => {
                if (err) reject(err); else resolve();
            });
        });

        // 6. الرفع
        const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
        await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: content.title, description: content.story, categoryId: '15' },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        res.send(`✅ تم النشر (إصدار V4.0)! \n العنوان: ${content.title} \n الفيديو صفحة: ${randomPage}`);

    } catch (err) {
        res.status(500).send("خطأ: " + err.message);
    } finally {
        fs.remove(workDir);
    }
});

app.listen(port, '0.0.0.0', () => console.log(`New Engine Active on ${port}`));
