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
        const oauth2Client = new google.auth.OAuth2(cleanKey(process.env.CLIENT_ID), cleanKey(process.env.CLIENT_SECRET), "https://developers.google.com/oauthplayground");
        oauth2Client.setCredentials(tokens);
        return google.youtube({ version: 'v3', auth: oauth2Client });
    } catch (e) { throw new Error("يوتيوب: فشل الإعداد"); }
};

app.get('/make-viral-video', async (req, res) => {
    req.setTimeout(600000); 
    const workDir = path.join(__dirname, `temp_${Date.now()}`);
    await fs.ensureDir(workDir);
    try {
        const youtube = getYoutubeClient();
        const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "قم بتلخيص قصة فيلم شهير جداً بأسلوب درامي ومشوق باللغة العربية. يجب أن يتجاوز النص 95 كلمة لضمان مدة فيديو كافية. أرسل النتيجة JSON حصراً: {\"title\": \"..\", \"story\": \"..\", \"search_term\": \"..\"}" }]
        }, { headers: { "Authorization": `Bearer ${cleanKey(process.env.GROQ_API_KEY)}` } });
        
        const content = JSON.parse(groqRes.data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);
        const audioPath = path.join(workDir, 'audio.mp3');
        const videoPath = path.join(workDir, 'video.mp4');
        const finalPath = path.join(workDir, 'final.mp4');
        
        await new Promise((resolve, reject) => {
            const gtts = new gTTS(content.story, 'ar');
            gtts.save(audioPath, (err) => err ? reject(err) : resolve());
        });
        
        const pexelsRes = await axios.get(`https://api.pexels.com/videos/search?query=${content.search_term || "drama"}&orientation=portrait&per_page=1`, { headers: { "Authorization": cleanKey(process.env.PEXELS_API) } });
        const videoUrl = pexelsRes.data.videos[0].video_files.find(f => f.width < 1000).link;
        const writer = fs.createWriteStream(videoPath);
        const vid = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        vid.data.pipe(writer);
        await new Promise((res) => writer.on('finish', res));

        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, [
                '-y', '-stream_loop', '-1', '-i', videoPath, '-i', audioPath,
                '-filter_complex', `[1:a]atempo=0.95[outa];[0:v]drawtext=text='${content.title}':fontcolor=white:fontsize=45:x=(w-text_w)/2:y=150:box=1:boxcolor=black@0.6[outv]`,
                '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-shortest', 
                '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280', finalPath
            ]);
            ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(new Error("FFmpeg Error")));
        });

        const uploadRes = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title: "تلخيص فيلم: " + content.title + " #shorts", description: content.story + "\n\n#movierecap #shorts", categoryId: "24" },
                status: { privacyStatus: 'public' }
            },
            media: { body: fs.createReadStream(finalPath) }
        });

        res.send(`✅ نجح الإنتاج! الرابط: https://youtu.be/${uploadRes.data.id}`);
    } catch (error) {
        res.status(500).send(`❌ خطأ V15 النهائي: ${error.message}`);
    } finally { fs.remove(workDir).catch(()=>{}); }
});

app.listen(port, '0.0.0.0', () => console.log(`V15 Masterpiece Ready`));
