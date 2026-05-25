# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: automations\apps\arquitectura-automatizacion\cases\c37927-validar-inicio-de-sesion-con-credenciales-validas\case.spec.ts >> Validar inicio de sesión con credenciales válidas
- Location: automations\apps\arquitectura-automatizacion\cases\c37927-validar-inicio-de-sesion-con-credenciales-validas\case.spec.ts:9:5

# Error details

```
Error: Missing required promoted data key 'usuario_valido'.
```

# Test source

```ts
  1  | import { test } from '@playwright/test';
  2  | import { config } from '../../../../../src/config/env';
  3  | import { buildDataContext } from '../../../../../src/data';
  4  | import { loadPromotedAppConfigSync, buildMergedConfig } from '../../../../../src/automations/app-profile';
  5  | 
  6  | import { HomePage } from '../../pages/home.page';
  7  | import { LoginPage } from '../../pages/login.page';
  8  | 
  9  | test('Validar inicio de sesión con credenciales válidas', async ({ page }) => {
  10 | 
  11 |   const __appConfig = loadPromotedAppConfigSync({ appSlug: 'arquitectura-automatizacion', configPath: 'automations/apps/arquitectura-automatizacion/app.config.json' });
  12 |   const __runtimeConfig = __appConfig ? buildMergedConfig(__appConfig, config) : config;
  13 |   const dataContext = buildDataContext(__runtimeConfig);
  14 |   const requirePromotedData = (ctx: { entries: Array<{ key: string; value: string }> }, key: string): string => {
  15 |     const normalizedKey = key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  16 |     const match = ctx.entries.find((entry) => entry.key === key) ?? ctx.entries.find((entry) => entry.key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() === normalizedKey);
> 17 |     if (!match || !match.value) throw new Error(`Missing required promoted data key '${key}'.`);
     |                                       ^ Error: Missing required promoted data key 'usuario_valido'.
  18 |     return match.value;
  19 |   };
  20 | 
  21 |   const homePage = new HomePage(page);
  22 |   const loginPage = new LoginPage(page);
  23 | 
  24 |   const usuario_valido = requirePromotedData(dataContext, 'usuario_valido');
  25 |   const contrasena_valida = requirePromotedData(dataContext, 'contrasena_valida');
  26 | 
  27 |   await homePage.openLoginModal(); // [target: Log in]
  28 |   await loginPage.expectLoginFormVisible(); // [target: Username]
  29 |   await loginPage.fillUsername(usuario_valido);
  30 |   await loginPage.fillPassword(contrasena_valida);
  31 |   await loginPage.submitLogin(); // [target: Log in]
  32 | });
```