const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const gTTS = require('gtts');
const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const app = express();
const port = process.env.PORT || 8080;

// دالة لتنظيف المفاتيح من المسافات المخفية
const cleanKey = (key) => key ? key.trim() : "";

app.get('/make-viral-video', async (req, res) => {
    const timeNow = new Date().toISOString();
    console.log(`بدء محاولة جديدة: ${timeNow}`);

    // تنظيف المفاتيح تلقائياً
    const GROQ_KEY = cleanKey(process.env.GROQ_API_KEY);
    const PEXELS_KEY = cleanKey(process.env.PEXELS_API);

    // فحص المفاتيح
    if (!GROQ_KEY) return res.send("❌ خطأ: مفتاح GROQ مفقود");
    if (!PEXELS_KEY) return res.send("❌ خطأ: مفتاح PEXELS مفقود");

    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);

    try {
        // 1. Groq (مع المفتاح النظيف)
        console.log("جاري الاتصال بـ Groq...");
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "اعطني عنواناً مضحكاً جداً وقصة قصيرة جداً عن قطة بصيغة JSON: {'title': '...', 'story': '...'}" }]
        }, { headers: { "Authorization": `Bearer ${GROQ_KEY}` } }); // استخدام المفتاح النظيف

        let content;
        try {
            content = JSON.parse(groqRes.data.choices[0].message.content);
        } catch (e) {
            content = { title: "عنوان احتياطي", story: groqRes.data.choices[0].message.content };
        }

        // 2. Pexels (مع المفتاح النظيف)
        console.log("جاري الاتصال بـ Pexels...");
        // استخدام المفتاح النظيف هنا أيضاً
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=cat&per_page=1&page=${Math.floor(Math.random() * 50) + 1}`, {
            headers: { "Authorization": PEXELS_KEY } 
        });
        
        if (!pexelsRes.data.videos.length) throw new Error("Pexels لم يجد فيديو");
        const videoUrl = pexelsRes.data.videos[0].video_files[0].link;

        // 3. (محاكاة المعالجة للسرعة في وضع الفحص)
        res.send(`✅ نجح التحديث الجديد (V7.1)! \n تم تنظيف المفاتيح والاتصال بنجاح. \n العنوان المقترح: ${content.title}`);

    } catch (err) {
        console.error(err);
        // عرض الخطأ بالتفصيل
        res.send(`⚠️ ما زال هناك خطأ: \n ${err.message} \n ${err.response ? JSON.stringify(err.response.data) : ''}`);
    } finally {
        fs.remove(workDir);
    }
});

app.listen(port, '0.0.0.0', () => console.log(`Server V7.1 Auto-Trim running on ${port}`));
