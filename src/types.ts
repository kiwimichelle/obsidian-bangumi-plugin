export type ArchiveMode = 'season' | 'year' | 'flat';
export type OverwriteMode = 'ask' | 'always' | 'never';
export type TemplateSource = 'default' | 'file';
export type SubjectTypeKey = 'anime' | 'book' | 'game' | 'music' | 'real';

export interface SubjectTypeConfig {
  // 归档
  archiveRoot: string;        // 归档根路径，如 ACG/Anime
  archiveMode: ArchiveMode;   // 归档方式
  // 封面
  coverPath: string;          // 封面存放路径，如 ACG/Anime/_covers
  // 模板
  templateSource: TemplateSource;
  templateFile: string;       // 库中模板文件路径（templateSource=file 时生效）
  // 覆盖
  overwriteMode: OverwriteMode;
}

export interface BangumiSettings {
  token: string;
  videoRootDir: string;       // 本地视频根目录，如 D:/Videos/Anime
  createVideoDir: boolean;    // 是否创建本地视频文件夹
  subjectTypes: Record<SubjectTypeKey, SubjectTypeConfig>;
}