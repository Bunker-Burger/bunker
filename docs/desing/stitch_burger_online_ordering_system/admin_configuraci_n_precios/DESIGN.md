---
name: Búnker Burguer Streetcraft
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#d8c3ad'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#a08e7a'
  outline-variant: '#534434'
  surface-tint: '#ffb95f'
  primary: '#ffc174'
  on-primary: '#472a00'
  primary-container: '#f59e0b'
  on-primary-container: '#613b00'
  inverse-primary: '#855300'
  secondary: '#ffb77d'
  on-secondary: '#4d2600'
  secondary-container: '#d97707'
  on-secondary-container: '#432100'
  tertiary: '#ffbcb7'
  on-tertiary: '#68000a'
  tertiary-container: '#ff938c'
  on-tertiary-container: '#8d0012'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffddb8'
  primary-fixed-dim: '#ffb95f'
  on-primary-fixed: '#2a1700'
  on-primary-fixed-variant: '#653e00'
  secondary-fixed: '#ffdcc3'
  secondary-fixed-dim: '#ffb77d'
  on-secondary-fixed: '#2f1500'
  on-secondary-fixed-variant: '#6e3900'
  tertiary-fixed: '#ffdad7'
  tertiary-fixed-dim: '#ffb3ad'
  on-tertiary-fixed: '#410004'
  on-tertiary-fixed-variant: '#930013'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display-hero:
    fontFamily: Oswald
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 52px
    letterSpacing: 0.02em
  display-hero-mobile:
    fontFamily: Oswald
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: 0.02em
  headline-lg:
    fontFamily: Oswald
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: 0.01em
  headline-lg-mobile:
    fontFamily: Oswald
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: 0.01em
  headline-md:
    fontFamily: Oswald
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: 0.01em
  title-sm:
    fontFamily: Oswald
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: 0.02em
  body-lg:
    fontFamily: Space Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Space Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Space Grotesk
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: Space Grotesk
    fontSize: 14px
    fontWeight: '700'
    lineHeight: 18px
    letterSpacing: 0.05em
  label-badge:
    fontFamily: Space Grotesk
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.08em
  price-tag:
    fontFamily: Oswald
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 24px
    letterSpacing: 0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-tablet: 1.5rem
  margin-desktop: 2.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style
The design system embodies an underground, rebellious, and unapologetic smash-burger joint culture. It caters to urban foodies, late-night cravings, and craft-burger purists who prioritize intense crust, melty cheese, and artisanal street swagger over delicate fine dining.

The visual style blends **High-Contrast Street Brutalism** with **Modern Craft Tactility**:
- Heavy atmospheric depth rooted in deep charcoal and pitch black.
- Piercing toasted amber and molten gold accents evoke melted cheddar, grilled brioche, and sizzling Maillard sear.
- Typography is loud, muscular, and bold, balanced with razor-sharp functional metadata for rapid mobile ordering.
- Tactile visual treatments celebrate grease-pencil menu boards, stamp marks, and bold badge labels.

## Colors
The palette captures the subterranean heat of the grill against raw bunker concrete:

- **Primary (`#F59E0B`)**: Radiant toasted gold. Used for key call-to-actions, active status states, rating badges, and price highlights.
- **Secondary (`#D97706`)**: Deep caramelized amber. Used for pressed states, secondary buttons, warm outlines, and interactive hover feedback.
- **Tertiary (`#EF4444`)**: Fiery chili red. Reserved for spicy indicators, cart alerts, sold-out tags, and urgent promotional banners.
- **Neutral Base (`#121212`)**: Matte cast-iron charcoal canvas, accompanied by `#0A0A0A` for base background depth and `#1F1F1F` / `#2A2A2A` for layered surface containers.
- **Text & Contrast (`#F3F4F6` and `#9CA3AF`)**: Crisp off-white ensures effortless readability against soot-dark surfaces, while muted slate handles secondary ingredients, descriptors, and nutrition footnotes.

## Typography
The typographic rhythm balances raw punchiness with crisp informational parsing:

- **Headlines (Oswald)**: Condensed, bold, and vertical. In all-caps or title case, it projects the authority of vintage street signage, butcher menus, and basement rock posters.
- **Body & Labels (Space Grotesk)**: Tech-forward, high-legibility geometric sans with subtle idiosyncratic cuts. It keeps complex burger ingredient lists, allergen notes, and checkout totals crisp on OLED screens under bright daylight or dimly lit venues.

## Layout & Spacing
A fluid 4-column layout on mobile scales to 8 columns on tablet and 12 columns on desktop. Max container width caps at 1280px to preserve tight optical scanlines.

- **Mobile First Focus**: The layout prioritizes single-thumb scrolling, sticky quick-order trays, and horizontal swipe carousels for sides, drinks, and daily specials.
- **Rhythm**: Element clusters (such as title, description, and price) rely on compact `space-xs` and `space-sm` pairings, while major category tiers (e.g., Smashes, Fries, Craft Sauces) separate using `space-xl`.

## Elevation & Depth
This design system avoids glossy or clean corporate drop shadows in favor of **Tonal Layering with Heated Ambient Glows**:

- **Layer 0 (Canvas)**: `#0A0A0A` (Underground void).
- **Layer 1 (Cards & Modules)**: `#141414` bordered by subtle 1px low-contrast strokes (`rgba(255, 255, 255, 0.08)`).
- **Layer 2 (Modals, Sticky Cart Tray, Overlays)**: `#1E1E1E` bordered by `rgba(245, 158, 11, 0.25)`.
- **Active / Accent Elevation**: Key interactive elements utilize an amber perimeter haze: `box-shadow: 0 4px 20px -2px rgba(245, 158, 11, 0.35)`.
- **Food Imagery Treatment**: Food photography utilizes high-contrast edge cuts or subtle bottom radial vignettes so buns, melting cheese, and charred patties visually jump out of the pitch-black backdrop.

## Shapes
A balanced hybrid shape language:
- **Product & Content Containers**: Use Level 2 (`rounded-md` / 0.5rem, scaling up to `rounded-lg` / 1rem for main product cards) to retain a structured, rugged, modern frame.
- **Tags, Filter Chips, and CTA Buttons**: Utilize full pill styling (`9999px`) to create an immediate visual contrast against geometric food cards and evoke industrial urban stamp badges.

## Components

### Buttons
- **Primary Action (e.g., "Add to Bag", "Order Now")**: Solid `#F59E0B` fill, bold black text (`#0A0A0A`), uppercase `Space Grotesk` label font, full pill shape (`rounded-full`), padded with `0.75rem 1.75rem`. Hover triggers a brightness shift to `#FBBF24` with an amber ambient halo.
- **Secondary Action (e.g., "Customize", "Details")**: Transparent fill, 1.5px border of `#D97706`, text in `#F3F4F6`, pill-shaped. Active press fills with `rgba(217, 119, 6, 0.15)`.

### Chips & Tags
- **Dietary & Feature Badges ("Double Smash", "Spicy", "Bestseller")**: Pill-shaped, semi-translucent dark fill (`rgba(255, 255, 255, 0.06)`), 1px solid border (`rgba(245, 158, 11, 0.4)`), text colored `#F59E0B`, uppercase `label-badge` styling.
- **Filter Tags**: Active chips gain full `#F59E0B` with dark `#0A0A0A` text; inactive chips remain `#1A1A1A` with `#9CA3AF` text.

### Food Cards (Mobile-First)
- **Structure**: Surface `#141414`, `rounded-lg`, 1px border `rgba(255, 255, 255, 0.08)`.
- **Image Section**: Full-width top or horizontal split on larger viewports, featuring crisp appetizing cutouts with a 15% bottom black vignette.
- **Content Hierarchy**:
  1. Category or badge pills (e.g., "Signature", "Smoked Bacon").
  2. Headline `headline-md` in `#F3F4F6`.
  3. Description `body-sm` in `#9CA3AF` (clamped to 2 lines).
  4. Footer: Golden bold `price-tag` aligned left, compact circular or pill `+` button aligned right.

### Input Fields & Steppers
- **Inputs**: Dark field `#1A1A1A`, 1px border `#333333`, focused border `#F59E0B` with `0 0 0 1px #F59E0B`. Placeholder in `#6B7280`, value in `#F3F4F6`.
- **Quantity Steppers**: Pill-shaped capsule containing minus, quantity counter, and plus, styled with heavy charcoal surfaces and amber interactive touch targets.

### Checkboxes & Radios (Add-ons & Extras)
- Custom circular (radio) and rounded square (checkbox) controls in `#262626`.
- Checked state fills with `#F59E0B` showing a pitch-black `#0A0A0A` checkmark or inner dot. Extra pricing (e.g., "+$2.50 Double Patty") displayed right-aligned in amber bold typography.