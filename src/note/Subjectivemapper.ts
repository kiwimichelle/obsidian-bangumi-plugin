import type {
  AnimeSubjective,
  BookSubjective,
  GameSubjective,
  MusicSubjective,
  RealSubjective,
  Subjective,
  SubjectTypeKey,
} from '../types';

/**
 * 将用户主观输入归一化为统一的字符串键值对。
 *
 * 单一数据源：NoteBuilder（模板变量）和 FrontmatterWriter（frontmatter 写入）
 * 均调用此函数，避免两处维护相同的 switch-case 导致遗漏。
 *
 * 所有键始终存在（未使用的字段为空字符串），方便模板引擎直接替换。
 */
export function buildSubjectiveFields(
  typeKey: SubjectTypeKey,
  subjective: Subjective,
): Record<string, string> {
  const fields: Record<string, string> = {
    my_status:        subjective.status,
    my_rating:        (subjective as AnimeSubjective).rating  ?? '',
    my_comment:       (subjective as AnimeSubjective).comment ?? '',
    my_progress:      '',
    my_source:        '',
    my_channel:       '',
    my_version:       '',
    my_read_progress: '',
    my_hours:         '',
    my_platform:      '',
    my_game_progress: '',
    my_music_source:  '',
  };

  switch (typeKey) {
    case 'anime': {
      const s = subjective as AnimeSubjective;
      fields['my_progress'] = s.progress;
      fields['my_source']   = s.source;
      break;
    }
    case 'book': {
      const s = subjective as BookSubjective;
      fields['my_channel'] = s.channel;
      fields['my_version'] = s.version;
      const parts = [
        s.volNum  ? `第${s.volNum}卷`  : '',
        s.unitNum ? `第${s.unitNum}话` : '',
      ].filter(Boolean);
      fields['my_read_progress'] = parts.join(' / ');
      break;
    }
    case 'game': {
      const s = subjective as GameSubjective;
      fields['my_hours']         = s.hours;
      fields['my_platform']      = s.platform;
      fields['my_game_progress'] = s.progress;
      break;
    }
    case 'music': {
      const s = subjective as MusicSubjective;
      fields['my_music_source'] = s.source;
      break;
    }
    case 'real': {
      const s = subjective as RealSubjective;
      fields['my_progress'] = s.progress;
      fields['my_source']   = s.source;
      break;
    }
  }

  return fields;
}