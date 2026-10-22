<?php
defined('ABSPATH') || exit;
get_header();

$shop = wc_get_page_permalink('shop');
$categories = urumi_categories();
$hero = wc_get_products(['status' => 'publish', 'limit' => 3, 'featured' => true]);
?>

<section class="hero" aria-labelledby="hero-title">
  <div class="container hero__grid">
    <div>
      <span class="eyebrow"><?php esc_html_e('The everyday collection', 'urumi'); ?></span>
      <h1 id="hero-title"><?php esc_html_e('Essentials, made to be', 'urumi'); ?> <em><?php esc_html_e('worn often.', 'urumi'); ?></em></h1>
      <p class="hero__lede"><?php esc_html_e('Hoodies, tees and accessories in soft, honest materials. Fewer things, chosen well.', 'urumi'); ?></p>
      <div class="hero__actions">
        <a class="button-primary" href="<?php echo esc_url($shop); ?>"><?php esc_html_e('Shop the collection', 'urumi'); ?></a>
        <?php if ($categories) : ?>
          <a class="button-quiet" href="<?php echo esc_url(get_term_link($categories[0])); ?>"><?php echo esc_html(sprintf(__('Browse %s', 'urumi'), strtolower($categories[0]->name))); ?></a>
        <?php endif; ?>
      </div>
    </div>
    <?php if ($hero) : ?>
      <div class="hero__mosaic">
        <?php foreach ($hero as $i => $product) : ?>
          <a href="<?php echo esc_url($product->get_permalink()); ?>" aria-label="<?php echo esc_attr($product->get_name()); ?>">
            <?php echo $product->get_image('woocommerce_single', ['loading' => $i ? 'lazy' : 'eager', 'alt' => '']); ?>
          </a>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </div>
</section>

<?php if ($categories) : ?>
<section class="section" aria-labelledby="categories-title">
  <div class="container">
    <div class="section__head">
      <h2 id="categories-title"><?php esc_html_e('Shop by category', 'urumi'); ?></h2>
      <a class="link-arrow" href="<?php echo esc_url($shop); ?>"><?php esc_html_e('View everything', 'urumi'); ?></a>
    </div>
    <div class="categories">
      <?php foreach (array_slice($categories, 0, 3) as $cat) : ?>
        <a class="category-tile" href="<?php echo esc_url(get_term_link($cat)); ?>">
          <div class="category-tile__media"><?php echo urumi_category_image($cat); ?></div>
          <h3><?php echo esc_html($cat->name); ?></h3>
          <p><?php echo esc_html(sprintf(_n('%d piece', '%d pieces', $cat->count, 'urumi'), $cat->count)); ?></p>
        </a>
      <?php endforeach; ?>
    </div>
  </div>
</section>
<?php endif; ?>

<section class="section" aria-labelledby="new-title">
  <div class="container">
    <div class="section__head">
      <h2 id="new-title"><?php esc_html_e('New arrivals', 'urumi'); ?></h2>
      <a class="link-arrow" href="<?php echo esc_url(add_query_arg('orderby', 'date', $shop)); ?>"><?php esc_html_e('Shop new', 'urumi'); ?></a>
    </div>
    <?php urumi_product_grid(['orderby' => 'date', 'order' => 'DESC']); ?>
  </div>
</section>

<?php $on_sale = wc_get_product_ids_on_sale(); if ($on_sale) : ?>
<section class="section" aria-labelledby="sale-title">
  <div class="container">
    <div class="section__head">
      <h2 id="sale-title"><?php esc_html_e('Quietly reduced', 'urumi'); ?></h2>
      <a class="link-arrow" href="<?php echo esc_url($shop); ?>"><?php esc_html_e('See all prices', 'urumi'); ?></a>
    </div>
    <?php urumi_product_grid(['include' => $on_sale, 'orderby' => 'price', 'order' => 'ASC']); ?>
  </div>
</section>
<?php endif; ?>

<section class="section" aria-label="<?php esc_attr_e('Why shop with us', 'urumi'); ?>">
  <div class="container promises">
    <div class="promise">
      <h3><?php esc_html_e('Pay on delivery', 'urumi'); ?></h3>
      <p><?php esc_html_e('Check out in a minute and pay in cash when your order arrives.', 'urumi'); ?></p>
    </div>
    <div class="promise">
      <h3><?php esc_html_e('No delivery charge', 'urumi'); ?></h3>
      <p><?php esc_html_e('The price you see is the price you pay. Nothing added at checkout.', 'urumi'); ?></p>
    </div>
    <div class="promise">
      <h3><?php esc_html_e('Made to last', 'urumi'); ?></h3>
      <p><?php esc_html_e('Considered fabrics and simple shapes that look better with every wear.', 'urumi'); ?></p>
    </div>
  </div>
</section>

<?php get_footer(); ?>
