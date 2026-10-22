<?php
/** Pages and posts (cart, checkout and account are pages holding WooCommerce blocks/shortcodes). */
defined('ABSPATH') || exit;
get_header();
?>
<div class="container page-content">
  <?php while (have_posts()) : the_post(); ?>
    <?php if (!(function_exists('is_wc_endpoint_url') && is_wc_endpoint_url('order-received'))) : ?>
      <h1><?php the_title(); ?></h1>
    <?php endif; ?>
    <?php the_content(); ?>
  <?php endwhile; ?>
</div>
<?php get_footer(); ?>
