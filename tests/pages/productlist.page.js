"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductListPage = void 0;
const promoted_spec_helpers_1 = require("../../../browser/promoted-spec-helpers");
class ProductListPage {
    page;
    constructor(page) {
        this.page = page;
    }
    async selectProduct(productName) {
        const normalize = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const target = normalize(productName);
        const allTokens = target.split(/\s+/).filter(t => t.length > 2);
        const strongTokens = allTokens.filter(t => !this.isStopWord(t));
        const tokensToMatch = strongTokens.length > 0 ? strongTokens : allTokens;
        if (tokensToMatch.length === 0) {
            throw new Error(`Product target "${productName}" has no meaningful tokens after normalization.`);
        }
        await (0, promoted_spec_helpers_1.waitForListReadiness)(this.page, { timeoutMs: 10000, pollMs: 500, minCards: 1 });
        const isMultiSelectScreen = await this.detectMultiSelectScreen();
        if (isMultiSelectScreen) {
            const multiSelected = await this.tryMultiSelect(tokensToMatch, productName);
            if (multiSelected)
                return;
        }
        const checkboxSelected = await this.trySelectCheckbox(tokensToMatch, productName);
        if (checkboxSelected)
            return;
        const roleRegex = this.buildFlexibleRegex(tokensToMatch);
        const rolesToTry = ['button', 'link', 'option', 'radio', 'checkbox', 'menuitem'];
        for (const role of rolesToTry) {
            const locator = this.page.getByRole(role, { name: roleRegex, exact: false });
            if (await locator.count() > 0) {
                await locator.first().click({ timeout: 10000 });
                return;
            }
        }
        let candidates = await this.scanVisibleCandidates(tokensToMatch);
        if (candidates.length === 0) {
            const diagnostics = await (0, promoted_spec_helpers_1.capturePageDiagnostics)(this.page);
            if (diagnostics.listReadiness.loadingDetected) {
                await this.page.waitForTimeout(2000);
                candidates = await this.scanVisibleCandidates(tokensToMatch);
            }
            if (candidates.length === 0 && diagnostics.listReadiness.cardsVisible > 0) {
                const subcategoryClicked = await this.tryNavigateSubcategory(tokensToMatch);
                if (subcategoryClicked) {
                    await (0, promoted_spec_helpers_1.waitForListReadiness)(this.page, { timeoutMs: 10000, pollMs: 500, minCards: 1 });
                    candidates = await this.scanVisibleCandidates(tokensToMatch);
                }
            }
        }
        if (candidates.length > 0) {
            const best = candidates[0];
            if (best.matchScore >= 0.5) {
                if (best.clickable) {
                    await best.elementHandle.click({ timeout: 10000 });
                    return;
                }
                const ancestor = await best.elementHandle.evaluateHandle((el) => {
                    let current = el;
                    let depth = 0;
                    const clickableTags = ['button', 'a', 'input', 'label'];
                    const clickableRoles = ['button', 'link', 'option', 'radio', 'checkbox', 'tab', 'menuitem'];
                    const clickableClassPatterns = ['card', 'cursor-pointer', 'clickable', 'btn', 'interactive', 'selectable'];
                    while (current && depth < 5) {
                        const tagName = current.tagName.toLowerCase();
                        const role = current.getAttribute('role');
                        const hasOnClick = !!current.onclick || current.getAttribute('onclick');
                        const hasClickableClass = clickableClassPatterns.some(pattern => {
                            const className = current.className || '';
                            return typeof className === 'string' && className.includes(pattern);
                        });
                        if (clickableTags.includes(tagName) || clickableRoles.includes(role || '') || hasOnClick || hasClickableClass) {
                            return current;
                        }
                        current = current.parentElement;
                        depth++;
                    }
                    return null;
                });
                const ancestorElement = ancestor.asElement();
                if (ancestorElement) {
                    await ancestorElement.click({ timeout: 10000 });
                    return;
                }
                await best.elementHandle.click({ timeout: 10000 });
                return;
            }
        }
        const headingRegex = this.buildFlexibleRegex(tokensToMatch);
        const headingLocator = this.page.locator('h1, h2, h3, h4, h5, h6').filter({ hasText: headingRegex }).first();
        try {
            if (await headingLocator.count() > 0) {
                const headingHandle = await headingLocator.elementHandle({ timeout: 5000 });
                if (headingHandle) {
                    const ancestor = await headingHandle.evaluateHandle((el) => {
                        let current = el;
                        let depth = 0;
                        const clickableTags = ['button', 'a', 'input', 'label'];
                        const clickableRoles = ['button', 'link', 'option', 'radio', 'checkbox', 'tab', 'menuitem'];
                        const clickableClassPatterns = ['card', 'cursor-pointer', 'clickable', 'btn', 'interactive', 'selectable'];
                        while (current && depth < 5) {
                            const tagName = current.tagName.toLowerCase();
                            const role = current.getAttribute('role');
                            const hasOnClick = !!current.onclick || current.getAttribute('onclick');
                            const hasClickableClass = clickableClassPatterns.some(pattern => {
                                const className = current.className || '';
                                return typeof className === 'string' && className.includes(pattern);
                            });
                            if (clickableTags.includes(tagName) || clickableRoles.includes(role || '') || hasOnClick || hasClickableClass) {
                                return current;
                            }
                            current = current.parentElement;
                            depth++;
                        }
                        return null;
                    });
                    const ancestorElement = ancestor.asElement();
                    if (ancestorElement) {
                        await ancestorElement.click({ timeout: 10000 });
                        return;
                    }
                    await headingLocator.click({ timeout: 10000 });
                    return;
                }
            }
        }
        catch {
            // Continue to final fallback
        }
        const fallbackLocator = this.page.locator(`:has-text("${productName.replace(/"/g, '\\"')}")`).first();
        if (await fallbackLocator.count() > 0) {
            await fallbackLocator.click({ timeout: 10000 });
            return;
        }
        const diagnostics = await (0, promoted_spec_helpers_1.capturePageDiagnostics)(this.page);
        const errorMsg = (0, promoted_spec_helpers_1.buildListReadinessErrorMessage)(productName, diagnostics, tokensToMatch, candidates);
        throw new Error(errorMsg);
    }
    isStopWord(token) {
        const stopWords = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'con', 'sin', 'por', 'para', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for']);
        return stopWords.has(token);
    }
    async tryNavigateSubcategory(tokens) {
        const normalize = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const currentUrl = this.page.url();
        if (currentUrl.includes('/success') || currentUrl === '/' || currentUrl.endsWith('/')) {
            return false;
        }
        const headings = await this.page.locator('h1:visible, h2:visible, h3:visible').all();
        let hasSubcategoryHeading = false;
        for (const h of headings) {
            try {
                const text = await h.textContent();
                if (text && /selecciona|subcategory|categor[aí]a|producto/i.test(text)) {
                    hasSubcategoryHeading = true;
                    break;
                }
            }
            catch {
                continue;
            }
        }
        if (!hasSubcategoryHeading) {
            const buttons = await this.page.locator('button:visible').all();
            if (buttons.length >= 3) {
                const modulePatterns = ['información de productos', 'transacciones y servicios', 'transacciones y services', 'iniciar', 'home', 'inicio'];
                let hasModuleButton = false;
                for (const btn of buttons.slice(0, 5)) {
                    try {
                        const text = await btn.textContent();
                        if (text && modulePatterns.some(p => normalize(text).includes(p))) {
                            hasModuleButton = true;
                            break;
                        }
                    }
                    catch {
                        continue;
                    }
                }
                if (hasModuleButton)
                    return false;
            }
        }
        const buttons = await this.page.locator('button:visible, [role="button"]:visible').all();
        if (buttons.length === 0)
            return false;
        let bestButton = null;
        for (const btn of buttons) {
            try {
                const text = await btn.textContent();
                if (!text || text.trim().length < 2)
                    continue;
                const normalizedText = normalize(text);
                let matchCount = 0;
                for (const token of tokens) {
                    if (normalizedText.includes(token))
                        matchCount++;
                }
                const score = matchCount / tokens.length;
                if (score > 0 && (!bestButton || score > bestButton.score)) {
                    bestButton = { element: btn, score };
                }
            }
            catch {
                continue;
            }
        }
        if (bestButton && bestButton.score >= 0.4) {
            try {
                await bestButton.element.click({ timeout: 10000 });
                return true;
            }
            catch {
                return false;
            }
        }
        return false;
    }
    async trySelectCheckbox(tokens, originalName) {
        const normalize = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const checkbox = this.page.getByRole('checkbox', { name: new RegExp(tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i'), exact: false });
        const checkboxCount = await checkbox.count().catch(() => 0);
        if (checkboxCount > 0) {
            const isChecked = await checkbox.first().isChecked().catch(() => false);
            if (!isChecked) {
                await checkbox.first().click({ timeout: 10000 });
                return true;
            }
            return true;
        }
        const labels = await this.page.locator('label:visible').all();
        for (const label of labels) {
            try {
                const text = await label.textContent();
                if (!text)
                    continue;
                const normalizedText = normalize(text);
                let matchCount = 0;
                for (const token of tokens) {
                    if (normalizedText.includes(token))
                        matchCount++;
                }
                if (matchCount === 0)
                    continue;
                const forAttr = await label.getAttribute('for').catch(() => null);
                if (forAttr) {
                    const input = this.page.locator(`input#${forAttr}`);
                    const type = await input.getAttribute('type').catch(() => '');
                    if (type === 'checkbox' || type === 'radio') {
                        const isChecked = await input.isChecked().catch(() => false);
                        if (!isChecked) {
                            await label.click({ timeout: 10000 });
                            return true;
                        }
                        return true;
                    }
                }
                const checkboxInside = label.locator('input[type="checkbox"], input[type="radio"]');
                const checkboxCount = await checkboxInside.count().catch(() => 0);
                if (checkboxCount > 0) {
                    const isChecked = await checkboxInside.first().isChecked().catch(() => false);
                    if (!isChecked) {
                        await label.click({ timeout: 10000 });
                        return true;
                    }
                    return true;
                }
            }
            catch {
                continue;
            }
        }
        const listItems = await this.page.locator('[role="listitem"]:visible, [class*="list-item"]:visible, [class*="listitem"]:visible').all();
        for (const item of listItems) {
            try {
                const text = await item.textContent();
                if (!text)
                    continue;
                const normalizedText = normalize(text);
                let matchCount = 0;
                for (const token of tokens) {
                    if (normalizedText.includes(token))
                        matchCount++;
                }
                if (matchCount === 0)
                    continue;
                const isSelected = await item.getAttribute('aria-selected').catch(() => null);
                const isCheckedAttr = await item.getAttribute('aria-checked').catch(() => null);
                const dataSelected = await item.getAttribute('data-selected').catch(() => null);
                const hasSelectedClass = await item.evaluate((el) => {
                    return el.classList.contains('selected') || el.classList.contains('active') || el.classList.contains('checked');
                }).catch(() => false);
                const isCurrentlySelected = isSelected === 'true' || isCheckedAttr === 'true' || dataSelected === 'true' || hasSelectedClass;
                if (!isCurrentlySelected) {
                    await item.click({ timeout: 10000 });
                    return true;
                }
                return true;
            }
            catch {
                continue;
            }
        }
        return false;
    }
    async detectMultiSelectScreen() {
        const continuarButton = this.page.getByRole('button', { name: /continuar.*\d+\s*producto/i, exact: false });
        if (await continuarButton.count() > 0)
            return true;
        const checkboxes = await this.page.locator('input[type="checkbox"]:visible').count().catch(() => 0);
        if (checkboxes >= 2)
            return true;
        return false;
    }
    async tryMultiSelect(tokens, originalName) {
        const normalize = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const regex = new RegExp(tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i');
        const cards = await this.page.locator('[class*="card"]:visible, [class*="Card"]:visible').all();
        for (const card of cards) {
            try {
                const text = await card.textContent();
                if (!text)
                    continue;
                const normalizedText = normalize(text);
                let matchCount = 0;
                for (const token of tokens) {
                    if (normalizedText.includes(token))
                        matchCount++;
                }
                if (matchCount === 0)
                    continue;
                const isSelected = await card.evaluate((el) => {
                    return el.classList.contains('selected') ||
                        el.classList.contains('active') ||
                        el.classList.contains('checked') ||
                        el.getAttribute('aria-selected') === 'true' ||
                        el.getAttribute('aria-checked') === 'true' ||
                        el.getAttribute('data-selected') === 'true' ||
                        !!el.querySelector('.selected, .active, .checked, input:checked');
                }).catch(() => false);
                if (!isSelected) {
                    await card.click({ timeout: 10000 });
                    return true;
                }
                return true;
            }
            catch {
                continue;
            }
        }
        const sections = await this.page.locator('section:visible, div[class*="product"]:visible, div[class*="entity"]:visible, div[class*="item"]:visible').all();
        for (const section of sections) {
            try {
                const text = await section.textContent();
                if (!text)
                    continue;
                const normalizedText = normalize(text);
                let matchCount = 0;
                for (const token of tokens) {
                    if (normalizedText.includes(token))
                        matchCount++;
                }
                if (matchCount === 0)
                    continue;
                const isSelected = await section.evaluate((el) => {
                    return el.classList.contains('selected') ||
                        el.classList.contains('active') ||
                        el.classList.contains('checked') ||
                        el.getAttribute('aria-selected') === 'true' ||
                        el.getAttribute('aria-checked') === 'true' ||
                        el.getAttribute('data-selected') === 'true';
                }).catch(() => false);
                if (!isSelected) {
                    await section.click({ timeout: 10000 });
                    return true;
                }
                return true;
            }
            catch {
                continue;
            }
        }
        const allVisible = await this.page.locator(':visible').all();
        for (const el of allVisible.slice(0, 200)) {
            try {
                const tagName = await el.evaluate((e) => e.tagName.toLowerCase());
                if (['script', 'style', 'head', 'meta', 'link'].includes(tagName))
                    continue;
                const text = await el.textContent();
                if (!text || text.trim().length < 5)
                    continue;
                const normalizedText = normalize(text);
                let matchCount = 0;
                for (const token of tokens) {
                    if (normalizedText.includes(token))
                        matchCount++;
                }
                if (matchCount < tokens.length)
                    continue;
                const children = await el.evaluate((e) => e.children.length);
                if (children > 10)
                    continue;
                const isSelected = await el.evaluate((e) => {
                    return e.classList.contains('selected') ||
                        e.classList.contains('active') ||
                        e.getAttribute('aria-selected') === 'true' ||
                        e.getAttribute('data-selected') === 'true';
                }).catch(() => false);
                if (!isSelected) {
                    await el.click({ timeout: 10000 });
                    return true;
                }
                return true;
            }
            catch {
                continue;
            }
        }
        return false;
    }
    buildFlexibleRegex(tokens) {
        const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return new RegExp(escaped.join('.*'), 'i');
    }
    buildTokenSetRegex(tokens) {
        const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return new RegExp(escaped.map(t => `(?=.*${t})`).join(''), 'i');
    }
    async scanVisibleCandidates(tokens) {
        const results = await this.page.evaluate((tokensToMatch) => {
            const normalize = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
            const clickableTags = new Set(['button', 'a', 'input', 'label']);
            const clickableRoles = new Set(['button', 'link', 'option', 'radio', 'checkbox', 'tab', 'menuitem']);
            const clickableClassPatterns = ['card', 'cursor-pointer', 'clickable', 'btn', 'interactive', 'selectable'];
            const isClickable = (el) => {
                const tagName = el.tagName.toLowerCase();
                const role = el.getAttribute('role');
                const hasOnClick = !!el.onclick || el.getAttribute('onclick');
                const hasClickableClass = clickableClassPatterns.some(pattern => {
                    const className = el.className || '';
                    return typeof className === 'string' && className.includes(pattern);
                });
                return clickableTags.has(tagName) || clickableRoles.has(role || '') || hasOnClick || hasClickableClass;
            };
            const hasCardClass = (el) => {
                const className = el.className || '';
                return typeof className === 'string' && clickableClassPatterns.some(p => className.includes(p));
            };
            const findClickableAncestor = (el) => {
                let current = el.parentElement;
                let depth = 0;
                while (current && depth < 5) {
                    if (isClickable(current))
                        return current;
                    current = current.parentElement;
                    depth++;
                }
                return null;
            };
            const getTextContent = (el) => {
                const texts = [];
                const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
                    acceptNode: (node) => {
                        const parent = node.parentElement;
                        if (!parent)
                            return NodeFilter.FILTER_REJECT;
                        const style = window.getComputedStyle(parent);
                        if (style.display === 'none' || style.visibility === 'hidden')
                            return NodeFilter.FILTER_REJECT;
                        return NodeFilter.FILTER_ACCEPT;
                    }
                });
                let node;
                while ((node = walker.nextNode())) {
                    const text = node.textContent?.trim();
                    if (text)
                        texts.push(text);
                }
                return texts.join(' ').trim();
            };
            const candidates = [];
            const allElements = document.querySelectorAll('button, a, [role="button"], [role="link"], [role="option"], [role="radio"], [role="checkbox"], [role="menuitem"], h1, h2, h3, h4, h5, h6, [class*="card"], [class*="list-item"], [class*="listitem"]');
            const seen = new Set();
            for (let i = 0; i < allElements.length; i++) {
                const el = allElements[i];
                const text = getTextContent(el);
                if (!text || text.length < 3)
                    continue;
                const normalized = normalize(text);
                if (seen.has(normalized.substring(0, 50)))
                    continue;
                seen.add(normalized.substring(0, 50));
                const matchedTokens = [];
                const unmatchedTokens = [];
                for (const token of tokensToMatch) {
                    if (normalized.includes(token)) {
                        matchedTokens.push(token);
                    }
                    else {
                        unmatchedTokens.push(token);
                    }
                }
                if (matchedTokens.length === 0)
                    continue;
                const score = matchedTokens.length / tokensToMatch.length;
                let clickableEl = el;
                let clickable = isClickable(el);
                if (!clickable) {
                    const ancestor = findClickableAncestor(el);
                    if (ancestor) {
                        clickableEl = ancestor;
                        clickable = true;
                    }
                }
                candidates.push({
                    text,
                    normalizedText: normalized,
                    matchedTokens,
                    unmatchedTokens,
                    matchScore: score,
                    clickable,
                    tag: clickableEl.tagName.toLowerCase(),
                    role: clickableEl.getAttribute('role'),
                    hasCardClass: hasCardClass(clickableEl),
                    elementIndex: i
                });
            }
            candidates.sort((a, b) => {
                if (b.matchScore !== a.matchScore)
                    return b.matchScore - a.matchScore;
                if (b.clickable !== a.clickable)
                    return (b.clickable ? 1 : 0) - (a.clickable ? 1 : 0);
                if (b.hasCardClass !== a.hasCardClass)
                    return (b.hasCardClass ? 1 : 0) - (a.hasCardClass ? 1 : 0);
                return a.text.length - b.text.length;
            });
            return candidates.slice(0, 10);
        }, tokens);
        const candidates = [];
        for (const r of results) {
            const locator = this.page.locator(`:has-text("${r.text.substring(0, 50).replace(/"/g, '\\"')}")`).first();
            try {
                const handle = await locator.elementHandle({ timeout: 3000 });
                if (handle) {
                    candidates.push({
                        text: r.text,
                        normalizedText: r.normalizedText,
                        matchedTokens: r.matchedTokens,
                        unmatchedTokens: r.unmatchedTokens,
                        matchScore: r.matchScore,
                        clickable: r.clickable,
                        elementHandle: handle,
                        tag: r.tag,
                        role: r.role,
                        hasCardClass: r.hasCardClass
                    });
                }
            }
            catch {
                // Element no longer visible, skip
            }
        }
        return candidates;
    }
    async selectFirstVisibleCard() {
        await (0, promoted_spec_helpers_1.waitForListReadiness)(this.page, { timeoutMs: 10000, pollMs: 500, minCards: 1 });
        const card = this.page.locator('[class*="card"]:visible, article:visible').first();
        if (await card.count() === 0)
            throw new Error('No visible card found to select.');
        await card.click({ timeout: 10000 });
    }
    async selectVisibleItemByOrdinal(ordinal, domainTerm) {
        await (0, promoted_spec_helpers_1.waitForListReadiness)(this.page, { timeoutMs: 10000, pollMs: 500, minCards: 1 });
        const ordinalNum = ordinal === 'first' ? 0 : ordinal === 'second' ? 1 : ordinal === 'third' ? 2 : -1;
        if (ordinalNum < 0)
            throw new Error('Unsupported ordinal: ' + ordinal);
        let items = this.page.locator('article:visible, [role="listitem"]:visible, [class*="product"]:visible, [class*="card"]:visible, [class*="item"]:visible').filter({ hasNotText: /selecciona un producto|seleccione un producto|elige un producto|choose a product|select a product/i });
        if (domainTerm) {
            const escaped = domainTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            items = items.filter({ hasText: new RegExp(escaped, 'i') });
        }
        const count = await items.count();
        if (count === 0)
            throw new Error('No visible items found for ordinal selection.');
        if (ordinalNum >= count)
            throw new Error(`Ordinal ${ordinal} (${ordinalNum + 1}) exceeds available items (${count}).`);
        const item = items.nth(ordinalNum);
        const actionable = item.locator('a:visible, button:visible, [role="button"]:visible').first();
        if (await actionable.count() > 0) {
            await actionable.click({ timeout: 10000 });
            return;
        }
        await item.click({ timeout: 10000 });
    }
}
exports.ProductListPage = ProductListPage;
