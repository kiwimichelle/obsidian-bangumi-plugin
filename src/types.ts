export type ArchiveMode = 'season' | 'year' | 'flat';
export type OverwriteMode = 'ask' | 'always' | 'never';
export type TemplateSource = 'default' | 'file';
export type SubjectTypeKey = 'anime' | 'book' | 'game' | 'music' | 'real';

export interface SubjectTypeConfig {
  archiveRoot: string;
  archiveMode: ArchiveMode;
  coverPath: string;
  templateSource: TemplateSource;
  templateFile: string;
  overwriteMode: OverwriteMode;
}

export interface BangumiSettings {
  token: string;
  videoRootDir: string;
  createVideoDir: boolean;
  subjectTypes: Record<SubjectTypeKey, SubjectTypeConfig>;
}