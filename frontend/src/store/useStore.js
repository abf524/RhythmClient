import { create } from 'zustand';
import axios from 'axios';

const API_BASE = (typeof window !== 'undefined' && window.location.origin.includes('localhost:5173'))
  ? 'http://localhost:3000'
  : (typeof window !== 'undefined' && window.location.origin.startsWith('http') ? window.location.origin : 'http://localhost:3000');

const useStore = create((set, get) => ({
  searchResults: [],
  selectedSongId: null,
  downloadQueue: [],
  isLoading: false,
  isDownloading: false,
  downloadProgress: { current: 0, total: 0 },
  
  filters: {
    q: '',
    instrument: '',
    difficulty: '',
    gameformat: '',
    genre: '',
    charter: '',
    year: ''
  },

  setFilter: (key, value) => {
    set((state) => ({
      filters: { ...state.filters, [key]: value }
    }));
  },

  resetFilters: () => {
    set({
      filters: {
        q: '',
        instrument: '',
        difficulty: '',
        gameformat: '',
        genre: '',
        charter: '',
        year: ''
      }
    });
  },

  setDownloading: (isDownloading, progress = { current: 0, total: 0 }) => {
    set({ isDownloading, downloadProgress: progress });
  },

  fetchSongs: async () => {
    set({ isLoading: true });
    try {
      const { q, instrument, difficulty, gameformat, genre, charter, year } = get().filters;
      
      const params = new URLSearchParams();
      if (q) params.append('q', q);
      if (instrument) params.append('instrument', instrument);
      if (difficulty) params.append('difficulty', difficulty);
      if (gameformat) params.append('gameformat', gameformat);
      if (genre) params.append('genre', genre);
      if (charter) params.append('charter', charter);
      if (year) params.append('year', year);

      const response = await axios.get(`${API_BASE}/api/search?${params.toString()}`);
      
      const songs = response.data || [];
      
      set({ 
        searchResults: songs, 
        isLoading: false,
        // Auto-select the first song if available
        selectedSongId: songs.length > 0 ? songs[0].id : null 
      });
      
    } catch (error) {
      console.error("Error fetching songs:", error);
      set({ isLoading: false, searchResults: [] });
    }
  },

  setSelectedSongId: (id) => set({ selectedSongId: id }),

  toggleSelectForDownload: (id) => {
    const queue = get().downloadQueue;
    if (queue.includes(id)) {
      set({ downloadQueue: queue.filter(item => item !== id) });
    } else {
      set({ downloadQueue: [...queue, id] });
    }
  },

  toggleSelectAll: () => {
    const { searchResults, downloadQueue } = get();
    if (downloadQueue.length === searchResults.length && searchResults.length > 0) {
      // Deselect all
      set({ downloadQueue: [] });
    } else {
      // Select all
      set({ downloadQueue: searchResults.map(s => s.id) });
    }
  },
  
  clearDownloadQueue: () => set({ downloadQueue: [] })
}));

export default useStore;

