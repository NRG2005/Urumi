<?php defined('ABSPATH') || exit; ?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
  <meta charset="<?php bloginfo('charset'); ?>">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<a class="skip-link screen-reader-text" href="#content"><?php esc_html_e('Skip to content', 'urumi'); ?></a>

<div class="announcement" role="region" aria-label="<?php esc_attr_e('Store announcement', 'urumi'); ?>">
  <p><?php esc_html_e('Pay cash on delivery · No delivery charge', 'urumi'); ?></p>
</div>

<header class="site-header">
  <div class="container site-header__inner">
    <nav class="site-nav" aria-label="<?php esc_attr_e('Primary', 'urumi'); ?>">
      <ul>
        <li><a href="<?php echo esc_url(wc_get_page_permalink('shop')); ?>"<?php echo is_shop() ? ' aria-current="page"' : ''; ?>><?php esc_html_e('Shop all', 'urumi'); ?></a></li>
        <?php foreach (urumi_categories() as $cat) : ?>
          <li><a href="<?php echo esc_url(get_term_link($cat)); ?>"<?php echo is_product_category($cat->slug) ? ' aria-current="page"' : ''; ?>><?php echo esc_html($cat->name); ?></a></li>
        <?php endforeach; ?>
      </ul>
    </nav>

    <a class="wordmark" href="<?php echo esc_url(home_url('/')); ?>" rel="home">Urumi <span>Supply</span></a>

    <div class="site-header__actions">
      <a class="account-link" href="<?php echo esc_url(wc_get_page_permalink('myaccount')); ?>"><?php esc_html_e('Account', 'urumi'); ?></a>
      <?php urumi_cart_link(); ?>
    </div>
  </div>
</header>

<main id="content" tabindex="-1">
