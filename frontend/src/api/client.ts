const API_BASE = 'http://localhost:8000/api';

export const api = {
  tracks: {
    list: async (
      page: number = 1,
      perPage: number = 1000,
      filters?: {
        tagIds?: number[];
        search?: string;
        energyMin?: number;
        energyMax?: number;
        tagMatchMode?: 'ANY' | 'ALL';
      }
    ) => {
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
      });

      if (filters) {
        if (filters.tagIds && filters.tagIds.length > 0) {
          filters.tagIds.forEach(id => params.append('tag_ids', id.toString()));
        }
        if (filters.search) {
          params.append('search', filters.search);
        }
        if (filters.energyMin !== undefined) {
          params.append('energy_min', filters.energyMin.toString());
        }
        if (filters.energyMax !== undefined) {
          params.append('energy_max', filters.energyMax.toString());
        }
        if (filters.tagMatchMode) {
          params.append('tag_match_mode', filters.tagMatchMode);
        }
      }

      const response = await fetch(`${API_BASE}/tracks/?${params}`);
      return response.json();
    },

    get: async (id: number) => {
      const response = await fetch(`${API_BASE}/tracks/${id}`);
      return response.json();
    },

    update: async (id: number, data: { energy?: number; tag_ids?: number[] }) => {
      const response = await fetch(`${API_BASE}/tracks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return response.json();
    },
  },

  tags: {
    listCategories: async () => {
      const response = await fetch(`${API_BASE}/tags/categories`);
      return response.json();
    },

    listByCategory: async (categoryId: number) => {
      const response = await fetch(`${API_BASE}/tags/categories/${categoryId}/tags`);
      return response.json();
    },

    listAll: async () => {
      const response = await fetch(`${API_BASE}/tags/`);
      return response.json();
    },
  },

  waveforms: {
    get: async (trackId: number) => {
      const response = await fetch(`${API_BASE}/waveforms/${trackId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch waveform: ${response.statusText}`);
      }
      return response.json();
    },

    updateCuePoint: async (trackId: number, cuePointTime: number | null) => {
      const response = await fetch(`${API_BASE}/waveforms/${trackId}/cue-point`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cue_point_time: cuePointTime }),
      });
      return response.json();
    },
  },
};
