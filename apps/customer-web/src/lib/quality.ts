/**
 * Product trust badges, re-exported from `@agrimarket/shared-domain/quality`.
 *
 * The decision of WHICH badge a product may show lives in the shared package so
 * the Web and Mobile screens cannot drift: a badge may only restate a fact the
 * backend holds (a linked farm, or a farm certificate the API still reports as
 * valid), never the product's category.
 */
export * from "@agrimarket/shared-domain/quality";
