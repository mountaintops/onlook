#!/bin/bash

# clean-cache.sh
# Recursively deletes cache and build artifacts:
# - .next
# - .npm
# - .bun/install (specifically targets install cache, PRESERVES .bun/bin)
# - node_modules
# - dist
# - build
# - .turbo
# - .cache (preserves puppeteer checks)

echo "Starting cleanup..."

# 1. Remove standard cache/build directories (Pruning node_modules to speed up search)
# This avoids traversing the massive node_modules tree while looking for other artifacts.
# REMOVED ".bun" from this list to handle it more safely below.
echo "Removing .next, .npm, dist, build, .turbo (skipping node_modules traversal)..."
find . -name "node_modules" -prune -o -type d \( -name ".next" -o -name ".npm" -o -name "dist" -o -name "build" -o -name ".turbo" \) -exec rm -rf {} +

# 2. Handle .bun directories specifically (delete install cache only)
echo "Cleaning .bun/install directories..."
# Find directories named ".bun", prune them so we don't search inside, then check if "install" exists inside.
find . -name "node_modules" -prune -o -name ".bun" -type d -prune | while read -r bun_dir; do
    if [ -d "$bun_dir/install" ]; then
        echo "Removing $bun_dir/install..."
        rm -rf "$bun_dir/install"
    fi
done

# 3. Handle node_modules deletion separately
echo "Scanning for node_modules to remove..."
# Use -prune to find only the top-level node_modules in each directory, avoiding nested searches inside node_modules
find . -name "node_modules" -type d -prune | while read -r nm_dir; do
    echo "Processing $nm_dir..."
    
    # Check for puppeteer cache inside this node_modules
    # Common locations: .cache/puppeteer
    puppeteer_cache="$nm_dir/.cache/puppeteer"
    
    if [ -d "$puppeteer_cache" ]; then
        echo "  Found puppeteer cache in $puppeteer_cache. preserving..."
        # Create a temporary location for the cache
        temp_cache_dir=$(mktemp -d)
        cp -r "$puppeteer_cache" "$temp_cache_dir/"
        
        # Remove the node_modules directory
        rm -rf "$nm_dir"
        
        # Restore the cache structure
        mkdir -p "$nm_dir/.cache"
        mv "$temp_cache_dir/puppeteer" "$nm_dir/.cache/"
        rm -rf "$temp_cache_dir"
        echo "  Restored puppeteer cache to $nm_dir/.cache/puppeteer"
    else
        # No cache to save, just delete
        rm -rf "$nm_dir"
    fi
done

# 4. Handle standalone .cache directories (outside node_modules)
echo "Checking other .cache directories..."
find . -name "node_modules" -prune -o -name ".cache" -type d -prune | while read -r cache_dir; do
    if [ -d "$cache_dir/puppeteer" ]; then
        echo "Preserving puppeteer cache in $cache_dir"
        # Delete everything in .cache EXCEPT puppeteer
        find "$cache_dir" -mindepth 1 -maxdepth 1 ! -name "puppeteer" -exec rm -rf {} +
    else
        echo "Removing $cache_dir"
        rm -rf "$cache_dir"
    fi
done

echo "Cleanup complete!"
