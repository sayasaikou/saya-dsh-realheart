/**
 * 兼容层：型号目录已按能力拆到 lib/catalog/ 下（2026-11-22）。
 *
 * 保留这个文件是因为它是对外的一层皮 —— index.mjs、以及可能的第三方用法都只认 'catalog.mjs'。
 * 真东西在 ./catalog/index.mjs，这里只做转发，不放任何数据。
 */
export {
  CATALOG,
  flattenCatalog,
  findCatalogModel,
  buildRecordFromCatalog,
  catalogRecordId,
  limitsLine,
} from './catalog/index.mjs';
