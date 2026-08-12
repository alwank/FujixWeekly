export type Recipe = {
  id: string;
  title: string;
  sourceUrl: string;
  publishedAt: string;
  modifiedAt: string;
  cameraGeneration: string;
  categories: string[];
  tags: string[];
  settings: { label: string; value: string }[];
  exampleImages: { sourceUrl: string; alt: string; caption: string }[];
};
