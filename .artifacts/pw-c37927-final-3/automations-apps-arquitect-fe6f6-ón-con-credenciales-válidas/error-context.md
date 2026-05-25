# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: automations\apps\arquitectura-automatizacion\cases\c37927-validar-inicio-de-sesion-con-credenciales-validas\case.spec.ts >> Validar inicio de sesión con credenciales válidas
- Location: automations\apps\arquitectura-automatizacion\cases\c37927-validar-inicio-de-sesion-con-credenciales-validas\case.spec.ts:9:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  getByLabel(/username|usuario/i).or(getByPlaceholder(/username|usuario/i)).first()
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByLabel(/username|usuario/i).or(getByPlaceholder(/username|usuario/i)).first()
    14 × locator resolved to <input type="text" id="sign-username" class="form-control"/>
       - unexpected value "hidden"

```

```yaml
- dialog "Log in":
  - document:
    - heading "Log in" [level=5]
    - button "Close"
    - text: "Username:"
    - textbox
    - text: "Password:"
    - textbox
    - button "Close"
    - button "Log in"
- navigation:
  - link "PRODUCT STORE":
    - /url: index.html
    - img
    - text: PRODUCT STORE
  - list:
    - listitem:
      - link "Home (current)":
        - /url: index.html
    - listitem:
      - link "Contact":
        - /url: "#"
    - listitem:
      - link "About us":
        - /url: "#"
    - listitem:
      - link "Cart":
        - /url: cart.html
    - listitem:
      - link "Log in":
        - /url: "#"
    - listitem
    - listitem
    - listitem:
      - link "Sign up":
        - /url: "#"
  - list:
    - listitem
    - listitem
    - listitem
  - img "First slide"
  - img "Second slide"
  - button "Previous"
  - button "Next"
- link "CATEGORIES":
  - /url: ""
- link "Phones":
  - /url: "#"
- link "Laptops":
  - /url: "#"
- link "Monitors":
  - /url: "#"
- link:
  - /url: prod.html?idp_=1
- heading "Samsung galaxy s6" [level=4]:
  - link "Samsung galaxy s6":
    - /url: prod.html?idp_=1
- heading "$360" [level=5]
- paragraph: The Samsung Galaxy S6 is powered by 1.5GHz octa-core Samsung Exynos 7420 processor and it comes with 3GB of RAM. The phone packs 32GB of internal storage cannot be expanded.
- link:
  - /url: prod.html?idp_=2
- heading "Nokia lumia 1520" [level=4]:
  - link "Nokia lumia 1520":
    - /url: prod.html?idp_=2
- heading "$820" [level=5]
- paragraph: The Nokia Lumia 1520 is powered by 2.2GHz quad-core Qualcomm Snapdragon 800 processor and it comes with 2GB of RAM.
- link:
  - /url: prod.html?idp_=3
- heading "Nexus 6" [level=4]:
  - link "Nexus 6":
    - /url: prod.html?idp_=3
- heading "$650" [level=5]
- paragraph: The Motorola Google Nexus 6 is powered by 2.7GHz quad-core Qualcomm Snapdragon 805 processor and it comes with 3GB of RAM.
- link:
  - /url: prod.html?idp_=4
- heading "Samsung galaxy s7" [level=4]:
  - link "Samsung galaxy s7":
    - /url: prod.html?idp_=4
- heading "$800" [level=5]
- paragraph: The Samsung Galaxy S7 is powered by 1.6GHz octa-core it comes with 4GB of RAM. The phone packs 32GB of internal storage that can be expanded up to 200GB via a microSD card.
- link:
  - /url: prod.html?idp_=5
- heading "Iphone 6 32gb" [level=4]:
  - link "Iphone 6 32gb":
    - /url: prod.html?idp_=5
- heading "$790" [level=5]
- paragraph: It comes with 1GB of RAM. The phone packs 16GB of internal storage cannot be expanded. As far as the cameras are concerned, the Apple iPhone 6 packs a 8-megapixel primary camera on the rear and a 1.2-megapixel front shooter for selfies.
- link:
  - /url: prod.html?idp_=6
- heading "Sony xperia z5" [level=4]:
  - link "Sony xperia z5":
    - /url: prod.html?idp_=6
- heading "$320" [level=5]
- paragraph: Sony Xperia Z5 Dual smartphone was launched in September 2015. The phone comes with a 5.20-inch touchscreen display with a resolution of 1080 pixels by 1920 pixels at a PPI of 424 pixels per inch.
- link:
  - /url: prod.html?idp_=7
- heading "HTC One M9" [level=4]:
  - link "HTC One M9":
    - /url: prod.html?idp_=7
- heading "$700" [level=5]
- paragraph: The HTC One M9 is powered by 1.5GHz octa-core Qualcomm Snapdragon 810 processor and it comes with 3GB of RAM. The phone packs 32GB of internal storage that can be expanded up to 128GB via a microSD card.
- link:
  - /url: prod.html?idp_=8
- heading "Sony vaio i5" [level=4]:
  - link "Sony vaio i5":
    - /url: prod.html?idp_=8
- heading "$790" [level=5]
- paragraph: Sony is so confident that the VAIO S is a superior ultraportable laptop that the company proudly compares the notebook to Apple's 13-inch MacBook Pro. And in a lot of ways this notebook is better, thanks to a lighter weight.
- link:
  - /url: prod.html?idp_=9
- heading "Sony vaio i7" [level=4]:
  - link "Sony vaio i7":
    - /url: prod.html?idp_=9
- heading "$790" [level=5]
- paragraph: REVIEW Sony is so confident that the VAIO S is a superior ultraportable laptop that the company proudly compares the notebook to Apple's 13-inch MacBook Pro. And in a lot of ways this notebook is better, thanks to a lighter weight, higher-resolution display, more storage space, and a Blu-ray drive.
- list:
  - listitem:
    - button "Previous"
  - listitem:
    - button "Next"
- heading "About Us" [level=4]
- paragraph: We believe performance needs to be validated at every stage of the software development cycle and our open source compatible, massively scalable platform makes that a reality.
- heading "Get in Touch" [level=4]
- paragraph: "Address: 2390 El Camino Real"
- paragraph: "Phone: +440 123456"
- paragraph: "Email: demo@blazemeter.com"
- heading "PRODUCT STORE" [level=4]:
  - img
  - text: PRODUCT STORE
- contentinfo:
  - paragraph: Copyright © Product Store
```

# Test source

```ts
  1  | import { Page, expect } from '@playwright/test';
  2  | 
  3  | // Page Object candidate: LoginPage
  4  | // Generated by page-object-codegen
  5  | // Screen signature: screen:arquitectura-automatizacion-login
  6  | // Status: candidate
  7  | // Confidence: 0.5
  8  | //
  9  | // REVIEW REQUIRED: This is a candidate Page Object.
  10 | // - Verify locators are correct for your application.
  11 | // - Rename methods if needed.
  12 | // - Do not activate until reviewed.
  13 | //
  14 | // Source plans: c37927-validar-inicio-de-sesion-con-credenciales-validas
  15 | 
  16 | export class LoginPage {
  17 |   constructor(private readonly page: Page) {}
  18 | 
  19 |   async expectLoginFormVisible(): Promise<void> {
> 20 |     await expect(this.page.getByLabel(/username|usuario/i).or(this.page.getByPlaceholder(/username|usuario/i)).first()).toBeVisible();
     |                                                                                                                         ^ Error: expect(locator).toBeVisible() failed
  21 | await expect(this.page.getByLabel(/password|contrasena/i).or(this.page.getByPlaceholder(/password|contrasena/i)).first()).toBeVisible();
  22 |   }
  23 | 
  24 |   async fillUsername(value: string): Promise<void> {
  25 |     const usernameInput = this.page.getByLabel(/username|usuario/i).or(this.page.getByPlaceholder(/username|usuario/i)).first();
  26 | await usernameInput.waitFor({ state: 'visible', timeout: 10000 });
  27 | await usernameInput.fill(value);
  28 |   }
  29 | 
  30 |   async fillPassword(value: string): Promise<void> {
  31 |     const passwordInput = this.page.getByLabel(/password|contrasena/i).or(this.page.getByPlaceholder(/password|contrasena/i)).first();
  32 | await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
  33 | await passwordInput.fill(value);
  34 |   }
  35 | 
  36 |   async submitLogin(): Promise<void> {
  37 |     const submitButton = this.page.getByRole('button', { name: /log in|iniciar sesion/i });
  38 | await submitButton.first().waitFor({ state: 'visible', timeout: 10000 });
  39 | await submitButton.first().click();
  40 |   }
  41 | }
  42 | 
```