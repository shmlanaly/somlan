import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

void main() => runApp(const InstaTikTokApp());

class InstaTikTokApp extends StatelessWidget {
  const InstaTikTokApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      theme: ThemeData.dark().copyWith(scaffoldBackgroundColor: Colors.black),
      home: const HomeScreen(),
      debugShowCheckedModeBanner: false,
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _currentIndex = 0;
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.black,
        title: const Text("Instagram", style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold)),
        actions: [
          IconButton(icon: const Icon(Icons.favorite_border), onPressed: () {}),
          IconButton(icon: const Icon(Icons.send_rounded), onPressed: () {}),
        ],
      ),
      body: Column(
        children: [
          // شريط القصص (Stories) - لمسة إنستقرام
          Container(
            height: 100,
            color: Colors.black,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: 10,
              itemBuilder: (context, i) => Padding(
                padding: const EdgeInsets.all(8.0),
                child: CircleAvatar(radius: 35, backgroundColor: Colors.pink, child: CircleAvatar(radius: 32, backgroundColor: Colors.grey[900])),
              ),
            ),
          ),
          // منطقة الفيديو (TikTok Player)
          const Expanded(child: VideoFeed()),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        backgroundColor: Colors.black,
        selectedItemColor: Colors.white,
        currentIndex: _currentIndex,
        onTap: (i) => setState(() => _currentIndex = i),
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.home), label: ""),
          BottomNavigationBarItem(icon: Icon(Icons.search), label: ""),
          BottomNavigationBarItem(icon: Icon(Icons.add_box_outlined), label: ""),
          BottomNavigationBarItem(icon: Icon(Icons.video_library), label: ""),
          BottomNavigationBarItem(icon: Icon(Icons.person_pin), label: ""),
        ],
      ),
    );
  }
}

class VideoFeed extends StatefulWidget {
  const VideoFeed({super.key});
  @override
  State<VideoFeed> createState() => _VideoFeedState();
}

class _VideoFeedState extends State<VideoFeed> {
  // الرابط الجديد الذي يعمل حالياً
  final String apiUrl = "https://practical-perle-yemen-3ec5b706.koyeb.app/feed";
  List videos = [];

  @override
  void initState() {
    super.initState();
    http.get(Uri.parse(apiUrl)).then((res) {
      if (res.statusCode == 200) setState(() => videos = json.decode(res.body));
    });
  }

  @override
  Widget build(BuildContext context) {
    return PageView.builder(
      scrollDirection: Axis.vertical,
      itemCount: videos.length,
      itemBuilder: (context, i) => Stack(
        children: [
          VideoItem(url: videos[i]['url']),
          Positioned(bottom: 10, left: 10, child: Text("@${videos[i]['username']}", style: const TextStyle(fontWeight: FontWeight.bold))),
        ],
      ),
    );
  }
}

class VideoItem extends StatefulWidget {
  final String url;
  const VideoItem({super.key, required this.url});
  @override
  State<VideoItem> createState() => _VideoItemState();
}

class _VideoItemState extends State<VideoItem> {
  late VideoPlayerController _vc;
  @override
  void initState() {
    super.initState();
    _vc = VideoPlayerController.networkUrl(Uri.parse(widget.url))..initialize().then((_) {
      setState(() {}); _vc.play(); _vc.setLooping(true);
    });
  }
  @override
  void dispose() { _vc.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    return _vc.value.isInitialized ? VideoPlayer(_vc) : const Center(child: CircularProgressIndicator());
  }
}
