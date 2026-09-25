/**
 * The paginator moved to `components/site` when the content listings started
 * using it: a blog page importing from `components/shop` would tie articles to
 * a module that may be switched off.
 *
 * This re-export keeps the storefront's import path working, here and in every
 * site already generated from this base.
 */
export { Pagination } from '../site/Pagination';
