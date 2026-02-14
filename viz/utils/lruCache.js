export class LruCache {
    constructor(maxSize = 200) {
        this.maxSize = Math.max(1, Number(maxSize) || 1);
        this.store = new Map();
    }

    get(key) {
        if (!this.store.has(key)) return undefined;

        const value = this.store.get(key);
        this.store.delete(key);
        this.store.set(key, value);

        return value;
    }

    set(key, value) {
        if (this.store.has(key)) {
            this.store.delete(key);
        }

        this.store.set(key, value);

        while (this.store.size > this.maxSize) {
            const firstKey = this.store.keys().next().value;
            this.store.delete(firstKey);
        }

        return value;
    }
}
