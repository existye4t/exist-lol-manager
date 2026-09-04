export type RuneforgeMod = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  publisher: { username: string } | null;
  description: string;
  thumbnailKey: string | null;
  category: string | null;
  viewCount: number;
  downloadCount: number;
  likeCount: number;
  champions: { id: number; name: string }[];
  themes: string[];
  features: string[];
  status: string | null;
  isGilded: boolean;
  publishedAt: string | null;
  isTrending: boolean;
};

export type RuneforgeCatalog = {
  mods: RuneforgeMod[];
  total: number;
};

export type RuneforgeCatalogQuery = {
  page: number;
  pageSize: number;
  search: string | null;
  championId: number | null;
  category: string | null;
  theme: string | null;
  feature: string | null;
};

export type RuneforgeChampions = {
  champions: { id: number; name: string }[];
};