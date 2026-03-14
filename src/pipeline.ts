/**
 * YAML pipeline executor.
 * Steps: fetch, navigate, evaluate, map, filter, sort, limit, select, snapshot, click, type, wait, press, intercept.
 */

import chalk from 'chalk';

export interface PipelineContext {
  args?: Record<string, any>;
  debug?: boolean;
}

export async function executePipeline(
  page: any,
  pipeline: any[],
  ctx: PipelineContext = {},
): Promise<any> {
  const args = ctx.args ?? {};
  const debug = ctx.debug ?? false;
  let data: any = null;
  const total = pipeline.length;

  for (let i = 0; i < pipeline.length; i++) {
    const step = pipeline[i];
    if (!step || typeof step !== 'object') continue;
    for (const [op, params] of Object.entries(step)) {
      if (debug) debugStepStart(i + 1, total, op, params);
      data = await executeStep(page, op, params, data, args);
      if (debug) debugStepResult(op, data);
    }
  }
  return data;
}

function normalizeEvaluateSource(source: string): string {
  const stripped = source.trim();
  if (!stripped) return '() => undefined';
  if (stripped.startsWith('(') && stripped.endsWith(')()')) return `() => (${stripped})`;
  if (/^(async\s+)?\([^)]*\)\s*=>/.test(stripped)) return stripped;
  if (/^(async\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=>/.test(stripped)) return stripped;
  if (stripped.startsWith('function ') || stripped.startsWith('async function ')) return stripped;
  return `() => (${stripped})`;
}

function debugStepStart(stepNum: number, total: number, op: string, params: any): void {
  let preview = '';
  if (typeof params === 'string') {
    preview = params.length <= 80 ? ` → ${params}` : ` → ${params.slice(0, 77)}...`;
  } else if (params && typeof params === 'object' && !Array.isArray(params)) {
    preview = ` (${Object.keys(params).join(', ')})`;
  }
  process.stderr.write(`  ${chalk.dim(`[${stepNum}/${total}]`)} ${chalk.bold.cyan(op)}${preview}\n`);
}

function debugStepResult(op: string, data: any): void {
  if (data === null || data === undefined) {
    process.stderr.write(`       ${chalk.dim('→ (no data)')}\n`);
  } else if (Array.isArray(data)) {
    process.stderr.write(`       ${chalk.dim(`→ ${data.length} items`)}\n`);
  } else if (typeof data === 'object') {
    const keys = Object.keys(data).slice(0, 5);
    process.stderr.write(`       ${chalk.dim(`→ dict (${keys.join(', ')}${Object.keys(data).length > 5 ? '...' : ''})`)}\n`);
  } else if (typeof data === 'string') {
    const p = data.slice(0, 60).replace(/\n/g, '\\n');
    process.stderr.write(`       ${chalk.dim(`→ "${p}${data.length > 60 ? '...' : ''}"`)}\n`);
  } else {
    process.stderr.write(`       ${chalk.dim(`→ ${typeof data}`)}\n`);
  }
}

// Single URL fetch helper
async function fetchSingle(
  page: any, url: string, method: string,
  queryParams: Record<string, any>, headers: Record<string, any>,
  args: Record<string, any>, data: any,
): Promise<any> {
  const renderedParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(queryParams)) renderedParams[k] = String(render(v, { args, data }));
  const renderedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) renderedHeaders[k] = String(render(v, { args, data }));

  let finalUrl = url;
  if (Object.keys(renderedParams).length > 0) {
    const qs = new URLSearchParams(renderedParams).toString();
    finalUrl = `${finalUrl}${finalUrl.includes('?') ? '&' : '?'}${qs}`;
  }

  if (page === null) {
    const resp = await fetch(finalUrl, { method: method.toUpperCase(), headers: renderedHeaders });
    return resp.json();
  }

  const headersJs = JSON.stringify(renderedHeaders);
  const escapedUrl = finalUrl.replace(/"/g, '\\"');
  return page.evaluate(`
    async () => {
      const resp = await fetch("${escapedUrl}", {
        method: "${method}", headers: ${headersJs}, credentials: "include"
      });
      return await resp.json();
    }
  `);
}

async function executeStep(page: any, op: string, params: any, data: any, args: Record<string, any>): Promise<any> {
  switch (op) {
    case 'navigate': {
      const url = render(params, { args, data });
      await page.goto(String(url));
      return data;
    }
    case 'fetch': {
      const urlOrObj = typeof params === 'string' ? params : (params?.url ?? '');
      const method = params?.method ?? 'GET';
      const queryParams: Record<string, any> = params?.params ?? {};
      const headers: Record<string, any> = params?.headers ?? {};
      const urlTemplate = String(urlOrObj);

      // Per-item fetch when data is array and URL references item
      if (Array.isArray(data) && urlTemplate.includes('item')) {
        const results: any[] = [];
        for (let i = 0; i < data.length; i++) {
          const itemUrl = String(render(urlTemplate, { args, data, item: data[i], index: i }));
          results.push(await fetchSingle(page, itemUrl, method, queryParams, headers, args, data));
        }
        return results;
      }
      const url = render(urlOrObj, { args, data });
      return fetchSingle(page, String(url), method, queryParams, headers, args, data);
    }
    case 'select': {
      const pathStr = String(render(params, { args, data }));
      if (data && typeof data === 'object') {
        let current = data;
        for (const part of pathStr.split('.')) {
          if (current && typeof current === 'object' && !Array.isArray(current)) current = (current as any)[part];
          else if (Array.isArray(current) && /^\d+$/.test(part)) current = current[parseInt(part, 10)];
          else return null;
        }
        return current;
      }
      return data;
    }
    case 'evaluate': {
      const js = String(render(params, { args, data }));
      return page.evaluate(normalizeEvaluateSource(js));
    }
    case 'snapshot': {
      const opts = (typeof params === 'object' && params) ? params : {};
      return page.snapshot({ interactive: opts.interactive ?? false, compact: opts.compact ?? false, maxDepth: opts.max_depth, raw: opts.raw ?? false });
    }
    case 'click': {
      await page.click(String(render(params, { args, data })).replace(/^@/, ''));
      return data;
    }
    case 'type': {
      if (typeof params === 'object' && params) {
        const ref = String(render(params.ref ?? '', { args, data })).replace(/^@/, '');
        const text = String(render(params.text ?? '', { args, data }));
        await page.typeText(ref, text);
        if (params.submit) await page.pressKey('Enter');
      }
      return data;
    }
    case 'wait': {
      if (typeof params === 'number') await page.wait(params);
      else if (typeof params === 'object' && params) {
        if ('text' in params) {
          const timeout = params.timeout ?? 10;
          const start = Date.now();
          while ((Date.now() - start) / 1000 < timeout) {
            const snap = await page.snapshot({ raw: true });
            if (typeof snap === 'string' && snap.includes(params.text)) break;
            await page.wait(0.5);
          }
        } else if ('time' in params) await page.wait(Number(params.time));
      } else if (typeof params === 'string') await page.wait(Number(render(params, { args, data })));
      return data;
    }
    case 'press': {
      await page.pressKey(String(render(params, { args, data })));
      return data;
    }
    case 'map': {
      if (!data || typeof data !== 'object') return data;
      let items: any[] = Array.isArray(data) ? data : [data];
      if (!Array.isArray(data) && typeof data === 'object' && 'data' in data) items = data.data;
      const result: any[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const row: Record<string, any> = {};
        for (const [key, template] of Object.entries(params)) row[key] = render(template, { args, data, item, index: i });
        result.push(row);
      }
      return result;
    }
    case 'filter': {
      if (!Array.isArray(data)) return data;
      return data.filter((item, i) => evalExpr(String(params), { args, item, index: i }));
    }
    case 'sort': {
      if (!Array.isArray(data)) return data;
      const key = typeof params === 'object' ? (params.by ?? '') : String(params);
      const reverse = typeof params === 'object' ? params.order === 'desc' : false;
      return [...data].sort((a, b) => { const va = a[key] ?? ''; const vb = b[key] ?? ''; const cmp = va < vb ? -1 : va > vb ? 1 : 0; return reverse ? -cmp : cmp; });
    }
    case 'limit': {
      if (!Array.isArray(data)) return data;
      return data.slice(0, Number(render(params, { args, data })));
    }
    case 'intercept': {
      // Declarative XHR interception step
      // Usage:
      //   intercept:
      //     trigger: "navigate:https://..." | "evaluate:store.note.fetch()" | "click:ref"
      //     capture: "api/pattern"     # URL substring to match
      //     timeout: 5                 # seconds to wait for matching request
      //     select: "data.items"       # optional: extract sub-path from response
      const cfg = typeof params === 'object' ? params : {};
      const trigger = cfg.trigger ?? '';
      const capturePattern = cfg.capture ?? '';
      const timeout = cfg.timeout ?? 8;
      const selectPath = cfg.select ?? null;

      if (!capturePattern) return data;

      // Step 1: Execute the trigger action
      if (trigger.startsWith('navigate:')) {
        const url = render(trigger.slice('navigate:'.length), { args, data });
        await page.goto(String(url));
      } else if (trigger.startsWith('evaluate:')) {
        const js = trigger.slice('evaluate:'.length);
        await page.evaluate(normalizeEvaluateSource(render(js, { args, data }) as string));
      } else if (trigger.startsWith('click:')) {
        const ref = render(trigger.slice('click:'.length), { args, data });
        await page.click(String(ref).replace(/^@/, ''));
      } else if (trigger === 'scroll') {
        await page.scroll('down');
      }

      // Step 2: Wait a bit for network requests to fire
      await page.wait(Math.min(timeout, 3));

      // Step 3: Get network requests and find matching ones
      const rawNetwork = await page.networkRequests(false);
      const matchingResponses: any[] = [];

      if (typeof rawNetwork === 'string') {
        // Parse the network output to find matching URLs
        const lines = rawNetwork.split('\n');
        for (const line of lines) {
          const match = line.match(/\[?(GET|POST)\]?\s+(\S+)\s*(?:=>|→)\s*\[?(\d+)\]?/i);
          if (match) {
            const [, method, url, status] = match;
            if (url.includes(capturePattern) && status === '200') {
              // Re-fetch the matching URL to get the response body
              try {
                const body = await page.evaluate(`
                  async () => {
                    try {
                      const resp = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
                      if (!resp.ok) return null;
                      return await resp.json();
                    } catch { return null; }
                  }
                `);
                if (body) matchingResponses.push(body);
              } catch {}
            }
          }
        }
      }

      // Step 4: Select from response if specified
      let result = matchingResponses.length === 1 ? matchingResponses[0] :
                   matchingResponses.length > 1 ? matchingResponses : data;

      if (selectPath && result) {
        let current = result;
        for (const part of String(selectPath).split('.')) {
          if (current && typeof current === 'object' && !Array.isArray(current)) {
            current = current[part];
          } else break;
        }
        result = current ?? result;
      }

      return result;
    }
    default: return data;
  }
}

// Template engine: ${{ ... }}
interface RenderContext { args?: Record<string, any>; data?: any; item?: any; index?: number; }

function render(template: any, ctx: RenderContext): any {
  if (typeof template !== 'string') return template;
  const fullMatch = template.match(/^\$\{\{\s*(.*?)\s*\}\}$/);
  if (fullMatch) return evalExpr(fullMatch[1].trim(), ctx);
  return template.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_m, expr) => String(evalExpr(expr.trim(), ctx)));
}

function evalExpr(expr: string, ctx: RenderContext): any {
  const args = ctx.args ?? {};
  const item = ctx.item ?? {};
  const data = ctx.data;
  const index = ctx.index ?? 0;

  // Default filter: args.limit | default(20)
  if (expr.includes('|') && expr.includes('default(')) {
    const [mainExpr, rest] = expr.split('|', 2);
    const defaultMatch = rest.match(/default\((.+?)\)/);
    const defaultVal = defaultMatch ? defaultMatch[1] : null;
    const result = resolvePath(mainExpr.trim(), { args, item, data, index });
    if (result === null || result === undefined) {
      if (defaultVal !== null) {
        const intVal = parseInt(defaultVal!, 10);
        if (!isNaN(intVal) && String(intVal) === defaultVal!.trim()) return intVal;
        return defaultVal!.replace(/^['"]|['"]$/g, '');
      }
    }
    return result;
  }

  // Arithmetic: index + 1
  const arithMatch = expr.match(/^([\w][\w.]*)\s*([+\-*/])\s*(\d+)$/);
  if (arithMatch) {
    const [, varName, op, numStr] = arithMatch;
    const val = resolvePath(varName, { args, item, data, index });
    if (val !== null && val !== undefined) {
      const numVal = Number(val); const num = Number(numStr);
      if (!isNaN(numVal)) {
        switch (op) {
          case '+': return numVal + num; case '-': return numVal - num;
          case '*': return numVal * num; case '/': return num !== 0 ? numVal / num : 0;
        }
      }
    }
  }

  // JS-like fallback expression: item.tweetCount || 'N/A'
  const orMatch = expr.match(/^(.+?)\s*\|\|\s*(.+)$/);
  if (orMatch) {
    const left = evalExpr(orMatch[1].trim(), ctx);
    if (left) return left;
    const right = orMatch[2].trim();
    return right.replace(/^['"]|['"]$/g, '');
  }

  return resolvePath(expr, { args, item, data, index });
}

function resolvePath(pathStr: string, ctx: RenderContext): any {
  const args = ctx.args ?? {};
  const item = ctx.item ?? {};
  const data = ctx.data;
  const index = ctx.index ?? 0;
  const parts = pathStr.split('.');
  const rootName = parts[0];
  let obj: any; let rest: string[];
  if (rootName === 'args') { obj = args; rest = parts.slice(1); }
  else if (rootName === 'item') { obj = item; rest = parts.slice(1); }
  else if (rootName === 'data') { obj = data; rest = parts.slice(1); }
  else if (rootName === 'index') return index;
  else { obj = item; rest = parts; }
  for (const part of rest) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) obj = obj[part];
    else if (Array.isArray(obj) && /^\d+$/.test(part)) obj = obj[parseInt(part, 10)];
    else return null;
  }
  return obj;
}
