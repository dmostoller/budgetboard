/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alerts from "../alerts.js";
import type * as budgets from "../budgets.js";
import type * as cards from "../cards.js";
import type * as categories from "../categories.js";
import type * as chat from "../chat.js";
import type * as crons from "../crons.js";
import type * as insights from "../insights.js";
import type * as lib from "../lib.js";
import type * as migrations from "../migrations.js";
import type * as recurrence from "../recurrence.js";
import type * as settings from "../settings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  budgets: typeof budgets;
  cards: typeof cards;
  categories: typeof categories;
  chat: typeof chat;
  crons: typeof crons;
  insights: typeof insights;
  lib: typeof lib;
  migrations: typeof migrations;
  recurrence: typeof recurrence;
  settings: typeof settings;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
