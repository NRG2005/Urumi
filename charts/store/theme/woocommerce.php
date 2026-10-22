<?php
/** Wraps every WooCommerce page (shop, categories, single product) in the theme's layout. */
defined('ABSPATH') || exit;
get_header();
?>
<div class="container">
  <?php if (is_product()) : woocommerce_breadcrumb(); else : ?>
    <div class="shop-head">
      <span class="eyebrow"><?php echo is_product_category() ? esc_html__('Category', 'urumi') : esc_html__('The collection', 'urumi'); ?></span>
    </div>
  <?php endif; ?>
  <?php woocommerce_content(); ?>
</div>
<?php get_footer(); ?>
