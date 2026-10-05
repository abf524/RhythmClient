const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const URLSearchParams = require('url').URLSearchParams;

const app = express();
app.use(cors());
app.use(express.json());

// Helper to extract file extension and clean filename
function cleanFilename(filename) {
    if (!filename) return 'download.zip';
    return filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
}

// Game format metadata and logos
const GAME_FORMATS = {
    ch: { name: 'Clone Hero', logo: 'https://rhythmverse.co/assets/media/games/ch.png' },
    chm: { name: 'Clone Hero', logo: 'https://rhythmverse.co/assets/media/games/ch.png' },
    gh3pc: { name: 'Guitar Hero World Tour PC', logo: 'https://rhythmverse.co/assets/media/games/gh.png' },
    wtde: { name: 'Guitar Hero WTDE', logo: 'https://rhythmverse.co/assets/media/games/wtde.png' },
    ps: { name: 'Phase Shift', logo: 'https://rhythmverse.co/assets/media/games/ps.png' },
    rv: { name: 'RhythmVerse', logo: 'https://rhythmverse.co/assets/media/games/rv.png' },
    rb2xbox: { name: 'Rock Band 2', logo: 'https://rhythmverse.co/assets/media/games/rb2.png' },
    rb3: { name: 'Rock Band 3', logo: 'https://rhythmverse.co/assets/media/games/rb3.png' },
    rb3ps3: { name: 'Rock Band 3 PS3', logo: 'https://rhythmverse.co/assets/media/games/RB3ps3.png' },
    rb3wii: { name: 'Rock Band 3 Wii', logo: 'https://rhythmverse.co/assets/media/games/RB3wii.png' },
    rb3xbox: { name: 'Rock Band 3 Xbox', logo: 'https://rhythmverse.co/assets/media/games/RB3xbox.png' },
    tbrb: { name: 'The Beatles: Rock Band', logo: 'https://rhythmverse.co/assets/media/games/tbrb.png' },
    tbrbps3: { name: 'The Beatles: Rock Band PS3', logo: 'https://rhythmverse.co/assets/media/games/tbrb.png' },
    tbrbxbox: { name: 'The Beatles: Rock Band Xbox', logo: 'https://rhythmverse.co/assets/media/games/tbrb.png' },
    yarg: { name: 'YARG', logo: 'https://rhythmverse.co/assets/media/games/yarg.png' }
};

// Helper to resolve charter display name / username to database shortname slug
async function resolveAuthorSlug(charterName) {
    if (!charterName || !charterName.trim()) return null;
    const clean = charterName.trim();
    const rvHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
    };

    try {
        const searchRes = await axios.post(
            'https://rhythmverse.co/api/community/authors/search/live',
            new URLSearchParams({ text: clean }).toString(),
            { headers: rvHeaders, timeout: 6000 }
        );
        const authors = searchRes.data?.data?.authors;
        if (Array.isArray(authors) && authors.length > 0) {
            const cleanLower = clean.toLowerCase();
            const exact = authors.find(a => 
                (a.name && a.name.toLowerCase() === cleanLower) ||
                (a.shortname && a.shortname.toLowerCase() === cleanLower)
            );
            if (exact && exact.shortname) return exact.shortname;
            if (authors[0].shortname) return authors[0].shortname;
        }
    } catch (e) {
        console.error("Author resolution error:", e.message);
    }
    return clean.toLowerCase();
}

app.get('/api/search', async (req, res) => {
    try {
        const { q, instrument, difficulty, gameformat, genre, charter, year } = req.query;
        const params = new URLSearchParams();
        params.append('data_type', 'full');
        params.append('page', '1');
        params.append('records', '100');
        
        // Sort by newest uploaded/updated charts first by default
        params.append('sort[0][sort_by]', 'update_date');
        params.append('sort[0][sort_order]', 'DESC');
        
        // Pass gameformat in path if specified
        const formatPath = (gameformat && gameformat !== 'all') ? gameformat.toLowerCase() : 'all';
        
        // Resolve charter name to database author slug
        let resolvedAuthor = null;
        if (charter && charter.trim()) {
            resolvedAuthor = await resolveAuthorSlug(charter);
            if (resolvedAuthor) {
                params.append('author', resolvedAuthor);
            }
        }

        if (genre && genre !== 'all' && genre.trim()) {
            params.append('genre', genre.trim().toLowerCase());
        }

        if (year && String(year).trim()) {
            params.append('year', String(year).trim());
        }

        let endpoint = `https://rhythmverse.co/api/${formatPath}/songfiles/list`;
        if (q && q.trim()) {
            params.append('text', q.trim());
            endpoint = `https://rhythmverse.co/api/${formatPath}/songfiles/search/live`;
        }

        const rvHeaders = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
        };

        let rvRes = await axios.post(endpoint, params.toString(), { headers: rvHeaders });

        let songs = (rvRes.data && rvRes.data.data && Array.isArray(rvRes.data.data.songs)) ? rvRes.data.data.songs : [];

        // Fallback 1: If charter was supplied with author parameter but returned 0 songs, try searching with charter directly as text
        if (songs.length === 0 && charter && charter.trim()) {
            const fallbackParams = new URLSearchParams();
            fallbackParams.append('data_type', 'full');
            fallbackParams.append('page', '1');
            fallbackParams.append('records', '100');
            fallbackParams.append('text', q && q.trim() ? `${q.trim()} ${charter.trim()}` : charter.trim());
            if (genre && genre !== 'all') fallbackParams.append('genre', genre.trim().toLowerCase());
            if (year) fallbackParams.append('year', String(year).trim());

            try {
                const fallbackRes = await axios.post(
                    `https://rhythmverse.co/api/${formatPath}/songfiles/search/live`,
                    fallbackParams.toString(),
                    { headers: rvHeaders }
                );
                if (fallbackRes.data && fallbackRes.data.data && Array.isArray(fallbackRes.data.data.songs)) {
                    songs = fallbackRes.data.data.songs;
                }
            } catch (err) {
                console.error("Charter text fallback error:", err.message);
            }
        }

        if (songs.length === 0) {
            return res.json([]);
        }

        // Apply local filtering for instrument and difficulty if provided
        if (instrument) {
            songs = songs.filter(s => {
                const instKey = `diff_${instrument.toLowerCase()}`;
                const hasInstInFile = s.file && s.file[instKey] !== null && s.file[instKey] !== undefined && s.file[instKey] !== -1 && s.file[instKey] !== '';
                const hasInstInData = s.data && s.data[instKey] !== null && s.data[instKey] !== undefined && s.data[instKey] !== -1 && s.data[instKey] !== '';
                return hasInstInFile || hasInstInData;
            });
        }

        if (difficulty !== undefined && difficulty !== null && difficulty !== '') {
            const targetDiff = parseInt(difficulty, 10);
            songs = songs.filter(s => {
                if (instrument) {
                    const instKey = `diff_${instrument.toLowerCase()}`;
                    const diffVal = parseInt(s.file?.[instKey] || s.data?.[instKey], 10);
                    return diffVal === targetDiff;
                } else {
                    const diffs = [
                        s.file?.diff_guitar, s.file?.diff_drums, s.file?.diff_bass,
                        s.file?.diff_vocals, s.file?.diff_keys
                    ];
                    return diffs.some(d => parseInt(d, 10) === targetDiff);
                }
            });
        }

        // Format clean JSON for frontend
        const formatted = songs.map(s => {
            const data = s.data || {};
            const file = s.file || {};
            
            let rawArt = file.album_art || data.album_art;
            let finalArt = null;
            if (rawArt) {
                if (rawArt.startsWith('http')) {
                    finalArt = rawArt;
                } else if (rawArt.startsWith('/')) {
                    finalArt = `https://rhythmverse.co${rawArt}`;
                } else {
                    finalArt = `https://rhythmverse.co/${rawArt}`;
                }
            }

            const rawFormat = (file.gameformat || data.gameformat || '').toLowerCase();
            const formatInfo = GAME_FORMATS[rawFormat] || (rawFormat ? {
                name: rawFormat.toUpperCase(),
                logo: `https://rhythmverse.co/assets/media/games/${rawFormat}.png`
            } : null);

            const charterName = (file.author && file.author.name) || file.user || data.user || s.user || 'Unknown';
            const releaseDate = file.release_date || file.record_created || file.upload_date || null;
            const updateDate = file.update_date || file.file_updated || null;
            const parsedYear = file.file_year || data.year || '';
            // Charter Avatar & Group Logo
            let charterAvatar = file.author?.avatar_path || data.author?.avatar_path || null;
            if (charterAvatar && charterAvatar.startsWith('/')) {
                charterAvatar = `https://rhythmverse.co${charterAvatar}`;
            }

            let charterGroupLogo = file.group?.logo_path || null;
            if (charterGroupLogo && charterGroupLogo.startsWith('/')) {
                charterGroupLogo = `https://rhythmverse.co${charterGroupLogo}`;
            }

            const charterIcon = charterGroupLogo || charterAvatar || null;
            const charterGroup = file.group?.group_name || null;

            return {
                id: s.id || file.file_id || data.song_id,
                title: file.file_title || data.title || s.file_name,
                artist: file.file_artist || data.artist || 'Unknown',
                originalFileName: file.file_name || file.filename || data.file_name || s.file_name || 'download',
                album: file.file_album || data.album || 'Unknown',
                genre: file.file_genre || data.genre || 'Unknown',
                year: parsedYear,
                charter: charterName,
                charterAvatar: charterAvatar,
                charterGroup: charterGroup,
                charterGroupLogo: charterGroupLogo,
                charterIcon: charterIcon,
                albumArt: finalArt,
                gameformat: rawFormat,
                gameformatName: formatInfo ? formatInfo.name : (rawFormat ? rawFormat.toUpperCase() : 'Custom'),
                gameformatLogo: formatInfo ? formatInfo.logo : null,
                releaseDate: releaseDate,
                updateDate: updateDate,
                rawDate: updateDate ? new Date(updateDate).getTime() : (releaseDate ? new Date(releaseDate).getTime() : 0),
                downloadUrl: file.download_url || file.external_url || data.download_url,
                difficulties: {
                    guitar: file.diff_guitar || data.diff_guitar,
                    drums: file.diff_drums || data.diff_drums,
                    bass: file.diff_bass || data.diff_bass,
                    vocals: file.diff_vocals || data.diff_vocals,
                    keys: file.diff_keys || data.diff_keys,
                    prokeys: file.diff_prokeys || data.diff_prokeys
                }
            };
        });

        res.json(formatted);

    } catch (error) {
        console.error("Search error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/download', async (req, res) => {
    try {
        let { url, filename, format } = req.query;
        if (!url) return res.status(400).json({ error: "URL is required" });

        // Normalize relative URLs from RhythmVerse
        if (url.startsWith('/')) {
            url = 'https://rhythmverse.co' + url;
        } else if (!url.startsWith('http')) {
            url = 'https://' + url;
        }

        console.log("Resolving download:", url);

        // Handle specific hosts
        if (url.includes('dropbox.com')) {
            url = url.replace('dl=0', 'dl=1');
        } else if (url.includes('mediafire.com')) {
            try {
                const mfRes = await axios.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                const $ = cheerio.load(mfRes.data);
                const dlButton = $('#downloadButton').attr('href');
                if (dlButton) {
                    url = dlButton;
                    console.log("MediaFire resolved to:", url);
                }
            } catch (err) {
                console.error("Failed to parse Mediafire:", err.message);
            }
        } else if (url.includes('drive.google.com')) {
            // Simplistic extraction of ID
            const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
            if (match) {
                url = `https://drive.google.com/uc?export=download&id=${match[1]}`;
            }
        }

        // Stream the file back
        const streamRes = await axios.get(url, {
            responseType: 'stream',
            decompress: false,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Encoding': 'identity'
            },
            maxRedirects: 5
        });

        // Resolve accurate filename
        let resolvedFilename = '';

        // 1. Check upstream content-disposition (e.g. MediaFire, Google Drive)
        const upstreamDisp = streamRes.headers['content-disposition'];
        if (upstreamDisp) {
            const utfMatch = upstreamDisp.match(/filename\*=UTF-8''([^;]+)/i);
            const stdMatch = upstreamDisp.match(/filename=["']?([^"';]+)["']?/i);
            const rawName = (utfMatch && utfMatch[1]) || (stdMatch && stdMatch[1]);
            if (rawName) {
                try {
                    const decoded = decodeURIComponent(rawName.trim());
                    if (decoded && decoded !== 'download' && decoded !== 'downloaded_file.zip') {
                        resolvedFilename = decoded;
                    }
                } catch (_) {
                    if (rawName && rawName !== 'download' && rawName !== 'downloaded_file.zip') {
                        resolvedFilename = rawName.trim();
                    }
                }
            }
        }

        // 2. Check query filename passed from frontend (which has song.originalFileName or Artist - Title)
        if (!resolvedFilename && filename && filename.trim()) {
            try {
                const decodedQueryName = decodeURIComponent(filename.trim());
                if (decodedQueryName && decodedQueryName !== 'download' && decodedQueryName !== 'downloaded_file.zip') {
                    resolvedFilename = decodedQueryName;
                }
            } catch (_) {
                resolvedFilename = filename.trim();
            }
        }

        // 3. Check URL path last segment
        if (!resolvedFilename) {
            try {
                const urlObj = new URL(url);
                const segments = urlObj.pathname.split('/').filter(Boolean);
                const last = segments[segments.length - 1];
                if (last && last !== 'download' && !/^[0-9a-f]{24,}$/i.test(last)) {
                    resolvedFilename = decodeURIComponent(last);
                }
            } catch (_) {}
        }

        // 4. Default fallback
        if (!resolvedFilename) {
            resolvedFilename = 'chart';
        }

        // Clean characters that are invalid in filenames on Windows
        resolvedFilename = resolvedFilename.replace(/[/\\?%*:|"<>]/g, '_').trim();

        // 5. Extension intelligence:
        // Ensure Clone Hero, Phase Shift, WTDE, YARG archives have .zip if not already present
        const hasExt = /\.[a-zA-Z0-9]{2,5}$/.test(resolvedFilename);
        const hasCon = resolvedFilename.toLowerCase().endsWith('_rb3con') || resolvedFilename.toLowerCase().endsWith('_con');
        if (!hasExt && !hasCon) {
            const fmt = (format || '').toLowerCase();
            if (['ch', 'chm', 'wtde', 'ps', 'yarg', 'gh3pc'].includes(fmt)) {
                resolvedFilename += '.zip';
            }
        }

        // Proxy headers
        res.setHeader('Content-Type', streamRes.headers['content-type'] || 'application/octet-stream');
        if (streamRes.headers['content-length']) {
            res.setHeader('Content-Length', streamRes.headers['content-length']);
        }
        if (streamRes.headers['content-encoding']) {
            res.setHeader('Content-Encoding', streamRes.headers['content-encoding']);
        }

        // Expose headers for frontend Axios and set Content-Disposition
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(resolvedFilename)}"; filename*=UTF-8''${encodeURIComponent(resolvedFilename)}`);

        streamRes.data.pipe(res);

    } catch (error) {
        console.error("Download error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

const path = require('path');
const fs = require('fs');

// Serve compiled React frontend in production if dist exists
const distPath = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.use((req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

let serverInstance = null;
function startServer(port = process.env.PORT || 3000) {
    return new Promise((resolve) => {
        if (serverInstance) return resolve(serverInstance);
        serverInstance = app.listen(port, () => {
            console.log(`RhythmClient Backend running on port ${port}`);
            resolve(serverInstance);
        });
    });
}

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer };

