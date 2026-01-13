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
    } catch (e) { throw new Error("YouTube Init Failed"); }
};

app.get('/make-viral-video', async (req, res) => {
    req.setTimeout(600000); 
    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);
    
    try {
        console.log("🚀 V15.0: بدء نظام تلخيص الأفلام...");
        const youtube = getYoutubeClient();

        // 1. طلب تلخيص لفيلم أو قصة عالمية (أكثر من 80 كلمة لضمان الوقت)
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ 
                role: "user", 
                content: "قم بتلخيص قصة فيلم خيال علمي أو دراما شهير بأسلوب مشوق جداً. يجب أن يكون النص طويلاً (حوالي 90 كلمة) باللغة العربية. أرسل النتيجة كـ JSON: {\"title\": \"اسم الفيلم\", \"story\": \"التلخيص..\", \"search_term\": \"كلمة للبحث عن فيديو متعلق\"}" 
            }]
        }, { headers: { "Authorization": `Bearer ${cleanKey(process.env.GROQ_API_KEY)}` } });
        
        const content = JSON.parse(groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);

        const audioPath = path.join(workDir, 'audio.mp3');
        const videoPath = path.join(workDir, 'video.mp4');
        
        await new Promise((res, rej) => {
            const gtts = new gTTS(content.story, 'ar');
            gtts.save(audioPath, (e) => e ? rej(e) : res());
        });

        // 2. البحث عن فيديو متعلق بالفيلم (مثلاً: دراما، فضاء، حرب)
        const searchTerm = content.search_term || "movie cinematic";
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=${searchTerm}&orientation=portrait&per_page=1`, { 
            headers: { "Authorization": cleanKey(process.env.PEXELS_API) } 
        });
        
        const videoUrl = pexelsRes.data.videos[0].video_files.find(f => f.width < 1000).link;
        const writer = fs.createWriteStream(videoPath);
        const vid = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        vid.data.pipe(writer);
        await new Promise((res) => writer.on('finish', res));

        // 3. الدمج مع إضافة نص توضيحي (Subtitles) تلقائياً
        const finalPath = path.join(workDir, 'final.mp4');
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, [
                '-y', 
                '-stream_loop', '-1', 
                '-i', videoPath, 
                '-i', audioPath,
                '-filter_complex', `[1:a]atempo=0.95[outa];[0:v]drawtext=text='${content.title}':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=100:box=1:boxcolor=black@0.5:boxborderw=5[outv]`,
                '-map', '[outv]',
                '-map', '[outa]',
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-shortest', 
                '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
                finalPath
            ]);

            ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(new Error("FFmpeg Fail")));
        });

        // 4. الرفع
        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { 
                    title: "تلخيص فيلم: " + content.title + " #shorts", 
                    description: content.story + "\n\n#movierecap #تلخيص_أفلام",
                    categoryId: "24" // Entertainment
                },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        res.send(`<h1>✅ تم إنتاج تلخيص فيلم (V15)!</h1><p>الرابط: https://youtu.be/${uploadRes.data.id}</p>`);

    } catch (error) {
        res.status(500).send(`❌ خطأ V15: ${error.message}`);
    } finally {
        fs.remove(workDir).catch(()=>{});
    }
});

app.listen(port, '0.0.0.0', () => console.log(`Movie Recap V15 Ready`));
