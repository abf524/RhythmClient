import React, { useEffect, useState, useMemo } from 'react';
import { 
  Search, Music, Download, DownloadCloud, Play, User, Calendar, Disc, 
  CheckSquare, Square, Loader2, ArrowUpDown, ArrowUp, ArrowDown, 
  SlidersHorizontal, X, RotateCcw, Filter, Sparkles 
} from 'lucide-react';
import axios from 'axios';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import useStore from './store/useStore';

const API_BASE = (typeof window !== 'undefined' && window.location.origin.includes('localhost:5173'))
  ? 'http://localhost:3000'
  : (typeof window !== 'undefined' && window.location.origin.startsWith('http') ? window.location.origin : 'http://localhost:3000');

export default function App() {
  const { 
    searchResults, 
    selectedSongId, 
    downloadQueue, 
    isLoading,
    isDownloading,
    downloadProgress,
    filters,
    setFilter,
    resetFilters,
    fetchSongs,
    setSelectedSongId,
    toggleSelectForDownload,
    toggleSelectAll,
    setDownloading,
    clearDownloadQueue
  } = useStore();

  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // Extract selected song
  const selectedSong = searchResults.find(s => s.id === selectedSongId);

  // Sorting handler
  const handleSort = (columnKey) => {
    setSortConfig(prev => {
      if (prev.key === columnKey) {
        if (prev.direction === 'asc') return { key: columnKey, direction: 'desc' };
        return { key: null, direction: 'asc' }; // Reset to default order
      }
      // For year or date, default to newest first ('desc'). For text, default to A-Z ('asc')
      const defaultDesc = columnKey === 'year' || columnKey === 'rawDate';
      return { key: columnKey, direction: defaultDesc ? 'desc' : 'asc' };
    });
  };

  // Memoized sorted songs
  const sortedSongs = useMemo(() => {
    if (!sortConfig.key) return searchResults;

    return [...searchResults].sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];

      if (sortConfig.key === 'year') {
        const numA = parseInt(aVal, 10) || 0;
        const numB = parseInt(bVal, 10) || 0;
        return sortConfig.direction === 'asc' ? numA - numB : numB - numA;
      }

      if (sortConfig.key === 'rawDate') {
        const dateA = Number(aVal) || 0;
        const dateB = Number(bVal) || 0;
        return sortConfig.direction === 'asc' ? dateA - dateB : dateB - dateA;
      }

      // Case-insensitive string comparison for A-Z / Z-A
      const strA = String(aVal || '').toLowerCase();
      const strB = String(bVal || '').toLowerCase();

      if (strA < strB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (strA > strB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [searchResults, sortConfig]);

  // Render sort icon indicator on columns
  const renderSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) {
      return <ArrowUpDown size={13} className="text-zinc-600 opacity-40 group-hover:opacity-100 transition-opacity" />;
    }
    if (sortConfig.direction === 'asc') {
      return <ArrowUp size={14} className="text-emerald-400 font-bold" />;
    }
    return <ArrowDown size={14} className="text-emerald-400 font-bold" />;
  };

  // Active filters count (excluding search query)
  const activeFiltersCount = [
    filters.instrument,
    filters.difficulty,
    filters.gameformat,
    filters.genre,
    filters.charter,
    filters.year
  ].filter(Boolean).length;

  const getSongDownloadFilename = (song) => {
    if (!song) return 'chart.zip';
    let name = (song.originalFileName || '').trim();
    if (!name || name === 'download' || name === 'downloaded_file.zip') {
      name = `${song.artist || 'Unknown'} - ${song.title || 'Chart'}`;
    }
    // Clean characters that are invalid in filenames on Windows
    name = name.replace(/[/\\?%*:|"<>]/g, '_').trim();

    const hasExt = /\.[a-zA-Z0-9]{2,5}$/.test(name);
    const hasCon = name.toLowerCase().endsWith('_rb3con') || name.toLowerCase().endsWith('_con');
    if (!hasExt && !hasCon) {
      const fmt = (song.gameformat || '').toLowerCase();
      // Clone Hero, Phase Shift, Guitar Hero, YARG use packed archives (.zip)
      if (['ch', 'chm', 'wtde', 'ps', 'yarg', 'gh3pc'].includes(fmt)) {
        name += '.zip';
      }
    }
    return name;
  };

  const extractFilename = (disposition, fallback) => {
    if (disposition) {
      // 1. Try filename*=UTF-8''...
      const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      if (utfMatch && utfMatch[1]) {
        try {
          const decoded = decodeURIComponent(utfMatch[1].replace(/["']/g, '').trim());
          if (decoded && decoded !== 'download' && decoded !== 'downloaded_file.zip') return decoded;
        } catch (_) {}
      }
      // 2. Try filename="..."
      const stdMatch = disposition.match(/filename=["']?([^"';]+)["']?/i);
      if (stdMatch && stdMatch[1]) {
        try {
          const decoded = decodeURIComponent(stdMatch[1].replace(/["']/g, '').trim());
          if (decoded && decoded !== 'download' && decoded !== 'downloaded_file.zip') return decoded;
        } catch (_) {
          const raw = stdMatch[1].replace(/["']/g, '').trim();
          if (raw && raw !== 'download' && raw !== 'downloaded_file.zip') return raw;
        }
      }
    }
    return fallback;
  };

  const handleSingleDownload = async () => {
    if (!selectedSong || !selectedSong.downloadUrl) return;
    setDownloading(true, { current: 0, total: 1 });
    try {
      const targetFilename = getSongDownloadFilename(selectedSong);
      const downloadParams = new URLSearchParams({
        url: selectedSong.downloadUrl,
        filename: targetFilename,
        format: selectedSong.gameformat || ''
      });

      const res = await axios.get(`${API_BASE}/api/download?${downloadParams.toString()}`, { 
        responseType: 'blob' 
      });
      const filename = extractFilename(res.headers['content-disposition'], targetFilename);
      saveAs(res.data, filename);
    } catch (e) {
      console.error("Single download failed:", e);
      alert("Download failed. See console for details.");
    }
    setDownloading(false);
  };

  const handleBulkDownload = async () => {
    if (downloadQueue.length === 0) return;
    
    setDownloading(true, { current: 0, total: downloadQueue.length });
    const zip = new JSZip();
    let downloadedCount = 0;

    try {
      for (const id of downloadQueue) {
        const song = searchResults.find(s => s.id === id);
        if (!song || !song.downloadUrl) {
          downloadedCount++;
          setDownloading(true, { current: downloadedCount, total: downloadQueue.length });
          continue;
        }

        try {
          const targetFilename = getSongDownloadFilename(song);
          const downloadParams = new URLSearchParams({
            url: song.downloadUrl,
            filename: targetFilename,
            format: song.gameformat || ''
          });

          const res = await axios.get(`${API_BASE}/api/download?${downloadParams.toString()}`, { 
            responseType: 'arraybuffer' 
          });
          const filename = extractFilename(res.headers['content-disposition'], targetFilename);
          
          // Ensure unique filenames inside the bulk zip
          let uniqueName = filename;
          let counter = 1;
          while (zip.file(uniqueName)) {
            const dot = filename.lastIndexOf('.');
            if (dot !== -1) {
              uniqueName = `${filename.substring(0, dot)} (${counter})${filename.substring(dot)}`;
            } else {
              uniqueName = `${filename} (${counter})`;
            }
            counter++;
          }

          zip.file(uniqueName, res.data);
        } catch(err) {
          console.error(`Failed to download ${song.title}:`, err);
        }

        downloadedCount++;
        setDownloading(true, { current: downloadedCount, total: downloadQueue.length });
      }

      setDownloading(true, { current: 'Zipping...', total: downloadQueue.length });
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, 'RhythmClient_Bulk_Download.zip');
      
      clearDownloadQueue();
    } catch (e) {
      console.error("Bulk download failed:", e);
      alert("Bulk download failed. See console for details.");
    }
    setDownloading(false);
  };

  // Initial fetch
  useEffect(() => {
    fetchSongs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      fetchSongs();
    }
  };

  const handleApplyAdvancedFilters = (e) => {
    if (e) e.preventDefault();
    fetchSongs();
  };

  const handleResetFilters = () => {
    resetFilters();
    setTimeout(() => {
      fetchSongs();
    }, 50);
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-300 font-sans">
      {/* Top Header */}
      <header className="h-16 border-b border-zinc-800 bg-zinc-900 flex items-center justify-between px-6 shrink-0 shadow-md relative z-20">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500 p-2 rounded-lg shadow-[0_0_12px_rgba(16,185,129,0.3)]">
            <Music className="text-zinc-950" size={20} />
          </div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight">RhythmClient</h1>
        </div>
        
        {/* Main Search Bar & Quick Filters */}
        <div className="flex items-center gap-3 flex-1 max-w-3xl ml-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input 
              type="text" 
              placeholder="Search for songs, artists, albums... (Press Enter)" 
              value={filters.q}
              onChange={(e) => setFilter('q', e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="w-full bg-zinc-800/50 border border-zinc-700 rounded-md py-2 pl-10 pr-4 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors text-sm text-zinc-100 placeholder:text-zinc-500 shadow-inner"
            />
          </div>
          
          <select 
            className="bg-zinc-800/60 border border-zinc-700 rounded-md py-2 px-3 text-sm focus:outline-none focus:border-emerald-500 cursor-pointer"
            value={filters.instrument}
            onChange={(e) => { setFilter('instrument', e.target.value); fetchSongs(); }}
          >
            <option value="">All Instruments</option>
            <option value="guitar">Guitar</option>
            <option value="drums">Drums</option>
            <option value="bass">Bass</option>
            <option value="vocals">Vocals</option>
            <option value="keys">Keys</option>
            <option value="prokeys">Pro Keys</option>
          </select>
          
          <select 
            className="bg-zinc-800/60 border border-zinc-700 rounded-md py-2 px-3 text-sm focus:outline-none focus:border-emerald-500 cursor-pointer"
            value={filters.difficulty}
            onChange={(e) => { setFilter('difficulty', e.target.value); fetchSongs(); }}
          >
            <option value="">Any Difficulty</option>
            <option value="0">0 - Warmup</option>
            <option value="1">1 - Apprentice</option>
            <option value="2">2 - Solid</option>
            <option value="3">3 - Moderate</option>
            <option value="4">4 - Challenging</option>
            <option value="5">5 - Nightmare</option>
            <option value="6">6 - Impossible</option>
          </select>

          {/* Advanced Search Toggle Button */}
          <button
            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
            className={`flex items-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium border transition-all ${
              isAdvancedOpen || activeFiltersCount > 0
                ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
                : 'bg-zinc-800/60 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
            }`}
            title="Open Advanced Filters"
          >
            <SlidersHorizontal size={16} />
            <span>Advanced</span>
            {activeFiltersCount > 0 && (
              <span className="bg-emerald-500 text-zinc-950 font-bold text-xs px-1.5 py-0.2 rounded-full ml-0.5">
                {activeFiltersCount}
              </span>
            )}
          </button>
        </div>

        {/* Bulk Download Action */}
        <div className="ml-auto flex items-center gap-4">
          <button 
            className={`flex items-center gap-2 py-2 px-4 rounded-md text-sm font-semibold transition-colors shadow-md ${
              downloadQueue.length > 0 && !isDownloading
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white' 
                : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
            disabled={downloadQueue.length === 0 || isDownloading}
            onClick={handleBulkDownload}
          >
            {isDownloading && typeof downloadProgress.current === 'number' && downloadProgress.total > 1 ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                Downloading ({downloadProgress.current}/{downloadProgress.total})
              </>
            ) : isDownloading && typeof downloadProgress.current === 'string' ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                {downloadProgress.current}
              </>
            ) : (
              <>
                <DownloadCloud size={18} />
                Bulk Download ({downloadQueue.length})
              </>
            )}
          </button>
        </div>
      </header>

      {/* Advanced Search Filter Drawer */}
      {isAdvancedOpen && (
        <section className="bg-zinc-900/95 border-b border-zinc-800 p-4 px-8 shadow-2xl backdrop-blur-md z-10 transition-all animate-in slide-in-from-top-2">
          <div className="max-w-7xl mx-auto flex flex-col gap-3">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                <Sparkles size={16} />
                <span>Advanced Song Chart Filters</span>
              </div>
              <button 
                onClick={() => setIsAdvancedOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-1">
              {/* Game Format / Chart Type Filter */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400">Chart Format / Game</label>
                <select 
                  className="bg-zinc-800/80 border border-zinc-700 rounded-md py-1.5 px-3 text-sm focus:outline-none focus:border-emerald-500 text-zinc-200"
                  value={filters.gameformat || ''}
                  onChange={(e) => setFilter('gameformat', e.target.value)}
                >
                  <option value="">All Formats</option>
                  <option value="ch">Clone Hero (CH)</option>
                  <option value="rb3">Rock Band 3 (All)</option>
                  <option value="rb3xbox">Rock Band 3 (Xbox 360)</option>
                  <option value="rb3ps3">Rock Band 3 (PS3)</option>
                  <option value="rb3wii">Rock Band 3 (Wii)</option>
                  <option value="rb2xbox">Rock Band 2</option>
                  <option value="yarg">YARG</option>
                  <option value="ps">Phase Shift</option>
                  <option value="wtde">Guitar Hero WTDE</option>
                  <option value="gh3pc">Guitar Hero PC</option>
                  <option value="tbrb">The Beatles: Rock Band</option>
                </select>
              </div>

              {/* Genre Filter */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400">Genre</label>
                <select 
                  className="bg-zinc-800/80 border border-zinc-700 rounded-md py-1.5 px-3 text-sm focus:outline-none focus:border-emerald-500 text-zinc-200"
                  value={filters.genre || ''}
                  onChange={(e) => setFilter('genre', e.target.value)}
                >
                  <option value="">All Genres</option>
                  <option value="rock">Rock</option>
                  <option value="metal">Metal</option>
                  <option value="numetal">Nu-Metal</option>
                  <option value="alternative">Alternative</option>
                  <option value="indierock">Indie Rock</option>
                  <option value="poprock">Pop-Rock</option>
                  <option value="punk">Punk</option>
                  <option value="grunge">Grunge</option>
                  <option value="jrock">J-Rock</option>
                  <option value="classicrock">Classic Rock</option>
                  <option value="prog">Prog</option>
                  <option value="popdanceelectronic">Pop / Electronic</option>
                  <option value="hiphoprap">Hip-Hop / Rap</option>
                  <option value="reggaeska">Reggae / Ska</option>
                </select>
              </div>

              {/* Charter / Author Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400">Charter / Creator</label>
                <input 
                  type="text"
                  placeholder="e.g. Riztoria, bravogangus..."
                  value={filters.charter || ''}
                  onChange={(e) => setFilter('charter', e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="bg-zinc-800/80 border border-zinc-700 rounded-md py-1.5 px-3 text-sm focus:outline-none focus:border-emerald-500 text-zinc-200 placeholder:text-zinc-600"
                />
              </div>

              {/* Release Year */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400">Release Year</label>
                <input 
                  type="number"
                  placeholder="e.g. 2022, 2007..."
                  value={filters.year || ''}
                  onChange={(e) => setFilter('year', e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="bg-zinc-800/80 border border-zinc-700 rounded-md py-1.5 px-3 text-sm focus:outline-none focus:border-emerald-500 text-zinc-200 placeholder:text-zinc-600"
                />
              </div>
            </div>

            {/* Filter Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleResetFilters}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 py-1.5 px-3 rounded-md hover:bg-zinc-800 transition-colors"
              >
                <RotateCcw size={14} />
                <span>Reset Filters</span>
              </button>

              <button
                type="button"
                onClick={handleApplyAdvancedFilters}
                className="flex items-center gap-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white py-1.5 px-4 rounded-md shadow transition-colors"
              >
                <Filter size={14} />
                <span>Apply Filters</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Main Body (Split View) */}
      <main className="flex-1 flex overflow-hidden">
        
        {/* Left Column (65%) */}
        <section className="w-[65%] border-r border-zinc-800 flex flex-col bg-zinc-900/30">
          <div className="flex-1 overflow-auto relative">
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/50 z-20 backdrop-blur-[1px]">
                <Loader2 className="animate-spin text-emerald-500" size={48} />
              </div>
            ) : null}

            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-zinc-900 sticky top-0 z-10 shadow-sm border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4 w-12 cursor-pointer" onClick={toggleSelectAll}>
                    {downloadQueue.length === searchResults.length && searchResults.length > 0 ? (
                      <CheckSquare className="text-emerald-500" size={18} />
                    ) : (
                      <Square className="text-zinc-500 hover:text-zinc-400" size={18} />
                    )}
                  </th>
                  
                  {/* Sortable Header: Song Name */}
                  <th 
                    className="py-3 px-4 font-semibold text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors group"
                    onClick={() => handleSort('title')}
                    title="Click to sort alphabetically (A-Z / Z-A)"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Song Name</span>
                      {renderSortIcon('title')}
                    </div>
                  </th>

                  {/* Sortable Header: Artist */}
                  <th 
                    className="py-3 px-4 font-semibold text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors group"
                    onClick={() => handleSort('artist')}
                    title="Click to sort alphabetically (A-Z / Z-A)"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Artist</span>
                      {renderSortIcon('artist')}
                    </div>
                  </th>

                  {/* Sortable Header: Charter */}
                  <th 
                    className="py-3 px-4 font-semibold text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors group"
                    onClick={() => handleSort('charter')}
                    title="Click to sort by Charter name (A-Z / Z-A)"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Charter</span>
                      {renderSortIcon('charter')}
                    </div>
                  </th>

                  {/* Sortable Header: Album */}
                  <th 
                    className="py-3 px-4 font-semibold text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors group"
                    onClick={() => handleSort('album')}
                    title="Click to sort by Album name (A-Z / Z-A)"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Album</span>
                      {renderSortIcon('album')}
                    </div>
                  </th>

                  {/* Sortable Header: Genre */}
                  <th 
                    className="py-3 px-4 font-semibold text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors group"
                    onClick={() => handleSort('genre')}
                    title="Click to sort by Genre (A-Z / Z-A)"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Genre</span>
                      {renderSortIcon('genre')}
                    </div>
                  </th>

                  {/* Sortable Header: Year */}
                  <th 
                    className="py-3 px-4 font-semibold text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors group"
                    onClick={() => handleSort('year')}
                    title="Click to sort by Year (Newest to Oldest / Oldest to Newest)"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Year</span>
                      {renderSortIcon('year')}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {!isLoading && sortedSongs.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="py-12 text-center text-zinc-500">
                      No songs found. Try adjusting your search or filters.
                    </td>
                  </tr>
                ) : (
                  sortedSongs.map(song => {
                    const isSelected = selectedSongId === song.id;
                    const isChecked = downloadQueue.includes(song.id);
                    return (
                      <tr 
                        key={song.id} 
                        onClick={() => setSelectedSongId(song.id)}
                        className={`border-b border-zinc-800/50 cursor-pointer transition-colors ${isSelected ? 'bg-zinc-800/80' : 'hover:bg-zinc-800/40'}`}
                      >
                        <td className="py-3 px-4" onClick={(e) => { e.stopPropagation(); toggleSelectForDownload(song.id); }}>
                          {isChecked ? (
                            <CheckSquare className="text-emerald-500" size={18} />
                          ) : (
                            <Square className="text-zinc-600 hover:text-zinc-400 transition-colors" size={18} />
                          )}
                        </td>
                        <td className="py-3 px-4 font-medium text-zinc-100">
                          <div className="flex items-center gap-2">
                            {song.gameformatLogo && (
                              <img 
                                src={song.gameformatLogo} 
                                alt="" 
                                className="h-4 w-auto max-w-[28px] object-contain shrink-0 opacity-80" 
                                title={song.gameformatName}
                              />
                            )}
                            <span className="truncate max-w-[260px]">{song.title}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-zinc-400">{song.artist}</td>
                        <td className="py-3 px-4 text-zinc-400">
                          <div className="inline-flex items-center gap-1.5 bg-zinc-800/80 px-2 py-1 rounded-md max-w-[130px]">
                            {song.charterAvatar && (
                              <img 
                                src={song.charterAvatar} 
                                alt="" 
                                className="w-3.5 h-3.5 rounded-full object-cover shrink-0" 
                                onError={(e) => { e.target.style.display = 'none'; }}
                              />
                            )}
                            <span className="text-xs truncate text-zinc-300">
                              {song.charter}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-zinc-400 truncate max-w-[160px]">{song.album}</td>
                        <td className="py-3 px-4 text-zinc-400">
                          <span className="bg-zinc-800 px-2 py-1 rounded-md text-xs truncate max-w-[120px] inline-block">
                            {song.genre}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-zinc-400">{song.year}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Right Column (35%) */}
        <aside className="w-[35%] bg-zinc-950 flex flex-col p-6 overflow-y-auto">
          {selectedSong ? (
            <div className="flex flex-col h-full fade-in">
              {/* Album Art & Title Section with Lower-Left Chart Logo Badge */}
              <div className="flex flex-col items-center mb-8">
                <div className="w-56 h-56 rounded-xl overflow-hidden shadow-2xl mb-6 bg-zinc-900 border border-zinc-800 flex items-center justify-center relative group">
                  {selectedSong.albumArt ? (
                    <img 
                      key={selectedSong.id}
                      src={selectedSong.albumArt} 
                      alt={selectedSong.album} 
                      className="w-full h-full object-cover" 
                      onError={(e) => {
                        e.target.onerror = null; 
                        e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="%233f3f46" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="2"></circle></svg>';
                        e.target.classList.remove('object-cover');
                        e.target.classList.add('p-12', 'opacity-50');
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-700">
                      <Disc size={64} />
                    </div>
                  )}

                  {/* Charter's Icon in Lower-Left Corner (if they have it) */}
                  {selectedSong.charterIcon ? (
                    <div 
                      className="absolute bottom-2.5 left-2.5 z-10 bg-zinc-950/85 backdrop-blur-md p-1 rounded-full border border-zinc-700/60 shadow-xl flex items-center justify-center transition-transform hover:scale-110"
                      title={`Charter: ${selectedSong.charter}${selectedSong.charterGroup ? ` (${selectedSong.charterGroup})` : ''}`}
                    >
                      <img 
                        src={selectedSong.charterIcon} 
                        alt={selectedSong.charter} 
                        className="w-8 h-8 rounded-full object-cover shadow-sm" 
                        onError={(e) => {
                          e.target.parentElement.style.display = 'none';
                        }}
                      />
                    </div>
                  ) : null}
                </div>

                <h2 className="text-3xl font-extrabold text-zinc-100 text-center mb-2 tracking-tight">{selectedSong.title}</h2>
                <p className="text-lg text-emerald-400 font-medium mb-1 text-center">{selectedSong.artist}</p>
                <p className="text-sm text-zinc-500 text-center">{selectedSong.album} • {selectedSong.year}</p>
              </div>

              {/* Stats & Info Grid */}
              <div className="bg-zinc-900/50 rounded-xl p-5 border border-zinc-800 mb-8 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <User size={16} />
                    <span className="text-sm">Charter</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-zinc-800 px-2 py-1 rounded max-w-[200px]">
                    {selectedSong.charterAvatar && (
                      <img 
                        src={selectedSong.charterAvatar} 
                        alt="" 
                        className="w-4 h-4 rounded-full object-cover shrink-0" 
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    )}
                    <span className="text-sm font-medium text-zinc-200 truncate">
                      {selectedSong.charter}
                    </span>
                  </div>
                </div>

                {/* Chart Format Info Row (KEPT THE SAME) */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Music size={16} />
                    <span className="text-sm">Chart Format</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-zinc-800/60 px-2 py-1 rounded border border-zinc-700/40">
                    {selectedSong.gameformatLogo && (
                      <img src={selectedSong.gameformatLogo} alt="" className="h-4 w-auto object-contain" />
                    )}
                    <span className="text-xs font-semibold text-emerald-400">{selectedSong.gameformatName}</span>
                  </div>
                </div>

                {/* Uploaded / Release Date */}
                {selectedSong.releaseDate && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <Calendar size={16} />
                      <span className="text-sm">Uploaded Date</span>
                    </div>
                    <span className="text-xs font-semibold text-zinc-300 bg-zinc-800/60 px-2 py-0.5 rounded">
                      {selectedSong.releaseDate.split(' ')[0]}
                    </span>
                  </div>
                )}
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Disc size={16} />
                    <span className="text-sm">Genre</span>
                  </div>
                  <span className="text-sm font-medium text-zinc-200 truncate max-w-[200px]">{selectedSong.genre}</span>
                </div>
                
                <div className="border-t border-zinc-800 pt-4 mt-2">
                  <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-3">Instruments & Difficulties</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(selectedSong.difficulties || {}).map(([inst, diff]) => {
                      if (diff === undefined || diff === null || diff === -1 || diff === '') return null;
                      
                      return (
                        <div key={inst} className="flex items-center justify-between bg-zinc-800/50 px-3 py-2 rounded-lg border border-zinc-700/50">
                          <span className="capitalize text-xs font-medium text-zinc-300">{inst}</span>
                          <div className="flex items-center gap-1">
                            {/* Map diff dots 1-6 */}
                            {[...Array(6)].map((_, i) => (
                              <div 
                                key={i} 
                                className={`w-1.5 h-3 rounded-sm ${i < parseInt(diff, 10) ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-zinc-700'}`} 
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-auto pt-4 flex gap-3">
                <button 
                  className={`flex-1 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${
                    selectedSong.downloadUrl && !isDownloading
                      ? 'bg-emerald-600 hover:bg-emerald-500 hover:shadow-emerald-900/50 cursor-pointer' 
                      : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  }`}
                  disabled={!selectedSong.downloadUrl || isDownloading}
                  onClick={handleSingleDownload}
                >
                  {isDownloading && downloadProgress.total === 1 ? (
                    <><Loader2 className="animate-spin" size={20} /> Downloading...</>
                  ) : (
                    <>
                      <Download size={20} />
                      {selectedSong.downloadUrl ? 'Download Song' : 'No Link Available'}
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500 flex-col gap-4">
              {isLoading ? (
                 <Loader2 className="animate-spin text-zinc-600" size={48} />
              ) : (
                <>
                  <Play size={48} className="opacity-20" />
                  <p>Select a song to view details</p>
                </>
              )}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
