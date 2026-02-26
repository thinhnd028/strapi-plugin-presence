export default ({ strapi }: { strapi: any }) => ({
    async find(ctx: any) {
        const {
            page = 1,
            pageSize = 25,
            action,
            contentType,
            source,
            search,
            sort = 'createdAt:desc',
        } = ctx.query;

        const where: any = {};

        if (action) where.action = action;
        if (contentType) where.contentType = { $contains: contentType };
        if (source) where.source = source;

        if (search) {
            where.$or = [
                { contentType: { $contains: search } },
                { targetDocumentId: { $contains: search } },
                { entryId: { $contains: search } },
            ];
        }

        const start = (Number(page) - 1) * Number(pageSize);

        const [entries, count] = await Promise.all([
            strapi.db.query('plugin::presence.action-history').findMany({
                where,
                orderBy: parseSort(sort),
                offset: start,
                limit: Number(pageSize),
            }),
            strapi.db.query('plugin::presence.action-history').count({ where }),
        ]);

        ctx.body = {
            data: entries,
            meta: {
                pagination: {
                    page: Number(page),
                    pageSize: Number(pageSize),
                    pageCount: Math.ceil(count / Number(pageSize)),
                    total: count,
                },
            },
        };
    },
    async findOne(ctx: any) {
        const { id } = ctx.params;
        const entry = await strapi.db.query('plugin::presence.action-history').findOne({
            where: { id: Number(id) || id },
        });
        if (!entry) return ctx.notFound();
        ctx.body = { data: entry };
    },
});

function parseSort(sort: string) {
    const parts = sort.split(':');
    const field = parts[0] || 'createdAt';
    const order = (parts[1] || 'desc').toLowerCase();
    return { [field]: order };
}
